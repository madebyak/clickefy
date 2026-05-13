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

categoriesRoute.get('/', async (c) => {
  const rows = await c.var.db.query.categories.findMany({
    orderBy: [asc(categories.sortOrder), asc(categories.name)],
  });
  return c.json({ data: rows });
});

categoriesRoute.get('/:id', async (c) => {
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

categoriesRoute.post(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('json', createCategorySchema),
  async (c) => {
    const body = c.req.valid('json');
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
