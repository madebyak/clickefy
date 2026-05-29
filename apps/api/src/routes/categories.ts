/**
 * /v1/categories — taxonomy CRUD.
 *
 * Public read is intentional: the mobile home screen renders the category
 * rail before the user has signed in (we don't want to gate browsing).
 * Mutations require the admin entitlement.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { categories } from '@clickfy/db';

import type { AppEnv } from '../types';
import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { byIp, withRateLimit } from '../middleware/with-rate-limit';

export const categoriesRoute = new Hono<AppEnv>();

// ─── Validation schemas ─────────────────────────────────────────────

const createCategorySchema = z.object({
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, digits, and hyphens only.'),
  iconUrl: z.string().url().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

const updateCategorySchema = createCategorySchema.partial();

// ─── Read ───────────────────────────────────────────────────────────

categoriesRoute.get(
  '/',
  withRateLimit((env) => env.RL_PUBLIC_IP, byIp),
  async (c) => {
    const rows = await c.var.db.query.categories.findMany({
      orderBy: [asc(categories.sortOrder), asc(categories.name)],
    });

    // Build a `children: Category[]` field for every row.
    //
    // Shape contract:
    //   - The response stays a *flat* list — every category (root and
    //     child) appears as a top-level entry, in the same order it did
    //     before this change. Existing consumers that iterate `data`
    //     and ignore `children` keep working unchanged.
    //   - Each root gets its direct children attached (already sorted by
    //     `sortOrder, name` thanks to the SQL order). Children rows get
    //     an empty `children: []` array, never nested deeper — the
    //     hierarchy is capped at two levels.
    //
    // Cost: O(N) where N = total category count (well under 100). Done
    // in JS to avoid a separate query; the bytes-on-the-wire overhead
    // is sub-KB for any realistic category tree.
    const childrenByParent = new Map<string, typeof rows>();
    for (const row of rows) {
      if (row.parentId) {
        const arr = childrenByParent.get(row.parentId) ?? [];
        arr.push(row);
        childrenByParent.set(row.parentId, arr);
      }
    }
    const data = rows.map((row) => ({
      ...row,
      children: row.parentId ? [] : (childrenByParent.get(row.id) ?? []),
    }));

    return c.json({ data });
  },
);

categoriesRoute.get('/:id', withRateLimit((env) => env.RL_PUBLIC_IP, byIp), async (c) => {
  const row = await c.var.db.query.categories.findFirst({
    where: eq(categories.id, c.req.param('id')),
  });
  if (!row) {
    return c.json({ error: { code: 'not_found', message: 'Category not found.' } }, 404);
  }
  return c.json({ data: row });
});

// ─── Bulk reorder (admin) ───────────────────────────────────────────
//
// Defined BEFORE the parameterised `/:id` routes so Hono matches the
// literal path. Accepts the desired ordering as an `ids` array — each
// row's `sortOrder` is set to its index in the array, atomically in a
// single SQL CASE statement so the new order is applied without
// intermediate inconsistent states.

const reorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

categoriesRoute.post(
  '/reorder',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('json', reorderSchema),
  async (c) => {
    const { ids } = c.req.valid('json');

    // Build `CASE WHEN id = $1 THEN 0 WHEN id = $2 THEN 1 ... END`.
    // Drizzle's `sql` template auto-parameterises each id so we stay
    // safe from injection even with this many bound values.
    const chunks = ids.map((id, idx) => sql`when ${categories.id} = ${id} then ${idx}`);
    const caseExpr = sql.join(
      [sql`case`, ...chunks, sql`else ${categories.sortOrder} end`],
      sql.raw(' '),
    );

    await c.var.db
      .update(categories)
      .set({ sortOrder: caseExpr, updatedAt: new Date() })
      .where(inArray(categories.id, ids));

    return c.json({ data: { reordered: ids.length } });
  },
);

// ─── Write (admin) ──────────────────────────────────────────────────

/**
 * Enforce the 2-level hierarchy cap (decision 5 of the sub-categories
 * design doc). Returns null when the parent is acceptable, or a JSON-
 * ready error tuple when it isn't.
 *
 * Three rejections, in order:
 *   1. parent doesn't exist
 *   2. parent itself has a parent (would create a grandchild)
 *   3. parent is the same row we're editing (self-parenting)
 *
 * The admin form filters these out client-side already (PR2), but
 * server-side is the authority — a stale dropdown, a hand-crafted
 * cURL, or a CLI tool must hit the same wall.
 */
async function validateParent(
  db: import('@clickfy/db').Db,
  parentId: string,
  editingId: string | null,
): Promise<{ code: string; message: string; status: 400 | 404 } | null> {
  if (editingId && parentId === editingId) {
    return {
      code: 'invalid_parent',
      message: 'A category cannot be its own parent.',
      status: 400,
    };
  }
  const parent = await db.query.categories.findFirst({
    where: eq(categories.id, parentId),
    columns: { id: true, parentId: true },
  });
  if (!parent) {
    return { code: 'parent_not_found', message: 'Parent category not found.', status: 404 };
  }
  if (parent.parentId !== null) {
    return {
      code: 'invalid_parent_depth',
      message:
        'Sub-categories cannot themselves have sub-categories — the hierarchy is capped at two levels. Pick a top-level category as the parent.',
      status: 400,
    };
  }
  return null;
}

categoriesRoute.post(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('json', createCategorySchema),
  async (c) => {
    const body = c.req.valid('json');

    if (body.parentId) {
      const bad = await validateParent(c.var.db, body.parentId, null);
      if (bad) {
        return c.json({ error: { code: bad.code, message: bad.message } }, bad.status);
      }
    }

    try {
      const [row] = await c.var.db
        .insert(categories)
        .values({
          name: body.name,
          slug: body.slug,
          iconUrl: body.iconUrl ?? null,
          parentId: body.parentId ?? null,
          sortOrder: body.sortOrder,
        })
        .returning();
      return c.json({ data: row }, 201);
    } catch (err) {
      if (err instanceof Error && err.message.includes('categories_slug_unique')) {
        return c.json(
          { error: { code: 'slug_taken', message: `Slug "${body.slug}" already exists.` } },
          409,
        );
      }
      throw err;
    }
  },
);

categoriesRoute.patch(
  '/:id',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('json', updateCategorySchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');

    // 2-level guard on the parent reassignment path. Only runs when
    // parentId is being SET (not when it's being cleared via `null` or
    // omitted from the patch — clearing a parent is always safe).
    if (body.parentId) {
      const bad = await validateParent(c.var.db, body.parentId, id);
      if (bad) {
        return c.json({ error: { code: bad.code, message: bad.message } }, bad.status);
      }
      // Additional guard: if THIS category already has children, it
      // can't itself become a child (that would push its children to
      // grandchild depth and violate the cap retroactively).
      const ownChildren = await c.var.db.query.categories.findFirst({
        where: eq(categories.parentId, id),
        columns: { id: true },
      });
      if (ownChildren) {
        return c.json(
          {
            error: {
              code: 'has_children',
              message:
                'This category has sub-categories of its own — move it to the top level first, or move its children elsewhere.',
            },
          },
          400,
        );
      }
    }

    const [row] = await c.var.db
      .update(categories)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.slug !== undefined && { slug: body.slug }),
        ...(body.iconUrl !== undefined && { iconUrl: body.iconUrl }),
        ...(body.parentId !== undefined && { parentId: body.parentId }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
        updatedAt: new Date(),
      })
      .where(eq(categories.id, id))
      .returning();
    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Category not found.' } }, 404);
    }
    return c.json({ data: row });
  },
);

categoriesRoute.delete(
  '/:id',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  async (c) => {
    const id = c.req.param('id');
    const [row] = await c.var.db
      .delete(categories)
      .where(eq(categories.id, id))
      .returning();
    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Category not found.' } }, 404);
    }
    return c.json({ data: { id: row.id, deleted: true } });
  },
);
