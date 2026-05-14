/**
 * /v1/catalog — public, mobile-facing read of published templates.
 *
 * Distinct from /v1/admin/templates in three ways:
 *   1. Only `status = 'published'` rows are returned.
 *   2. Every row is projected through `templateToMobileDTO` to strip
 *      admin-only fields (`generation`, `output`) and resolve media
 *      references to delivery URLs.
 *   3. No auth required — the home screen renders before sign-in.
 *
 * Cloudflare Stream subdomain is intentionally read from `c.env` rather
 * than a global constant so we can vary it per deploy (preview vs prod)
 * without rebuilding the worker bundle.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { savedTemplates, templates, users } from '@clickfy/db';

import type { AppEnv } from '../types';
import { templateToMobileDTO } from '../lib/template-dto';
import { buildHomeSections } from '../lib/section-builder';
import { withAuth } from '../middleware/with-auth';
import { byClerkUserId, byIp, withRateLimit } from '../middleware/with-rate-limit';

export const catalog = new Hono<AppEnv>();

/**
 * Public catalog responses are cached aggressively at Cloudflare's
 * edge — they're identical for every signed-out and signed-in user,
 * and a 60s lag on newly-published templates is acceptable.
 *
 *   - `s-maxage=60`             — edge cache freshness window
 *   - `stale-while-revalidate=300` — keep serving stale for 5min while
 *     the Worker refreshes in the background; clients never see a slow
 *     request on cache misses past the freshness window
 *   - `public`                  — explicitly cacheable by intermediaries
 *
 * If we ever need to bust this proactively (e.g. on admin publish),
 * we can call `caches.default.delete(url)` in the publish handler.
 */
const PUBLIC_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
} as const;

// ─── Templates listing ──────────────────────────────────────────────

/**
 * GET /v1/catalog/templates
 *
 * Filters (all optional):
 *   - search      — substring match on title (case-insensitive)
 *   - kind        — image | video | image_set
 *   - categoryId
 *   - featured    — restrict to featured templates only
 *   - cursor / limit
 *
 * Default ordering: featured first, then `sortOrder ASC`, with `id` as
 * a stable tiebreaker. Pagination is cursor-based on `(sortOrder, id)`
 * — see the same pattern in routes/templates.ts.
 */
const listQuerySchema = z.object({
  search: z.string().max(120).optional(),
  kind: z.enum(['image', 'video', 'image_set']).optional(),
  categoryId: z.string().uuid().optional(),
  featured: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  /**
   * Ordering knob:
   *   - `default` (omitted)        — featured first, then sortOrder ASC.
   *                                   Best for human-curated rails.
   *   - `recent`                   — most recently published first.
   *                                   Used by mobile "New Arrivals" etc.
   */
  sort: z.enum(['default', 'recent']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

catalog.get(
  '/templates',
  withRateLimit((env) => env.RL_PUBLIC_IP, byIp),
  zValidator('query', listQuerySchema),
  async (c) => {
  const q = c.req.valid('query');

  const whereParts: SQL[] = [eq(templates.status, 'published')];
  if (q.search) whereParts.push(ilike(templates.title, `%${q.search}%`));
  if (q.kind) whereParts.push(eq(templates.kind, q.kind));
  if (q.categoryId) whereParts.push(eq(templates.categoryId, q.categoryId));
  if (q.featured !== undefined) whereParts.push(eq(templates.featured, q.featured));

  // Cursor format depends on the active sort. We keep them disjoint so
  // a cursor minted under one ordering can't accidentally page through
  // the other. The cursor always carries a stable tiebreaker (`id`).
  const useRecent = q.sort === 'recent';

  if (q.cursor) {
    if (useRecent) {
      const [iso, idCursor] = q.cursor.split('::');
      if (iso && idCursor) {
        // `published_at` may be null for legacy rows; we treat null as
        // "less than every real timestamp" by using `COALESCE` server-
        // side in the comparison.
        whereParts.push(
          sql`(COALESCE(${templates.publishedAt}, ${templates.createdAt}), ${templates.id}::text) < (${iso}::timestamptz, ${idCursor})`,
        );
      }
    } else {
      const [sortOrderRaw, idCursor] = q.cursor.split(':');
      const sortOrderCursor = Number.parseInt(sortOrderRaw, 10);
      if (Number.isFinite(sortOrderCursor) && idCursor) {
        whereParts.push(
          sql`(${templates.sortOrder}, ${templates.id}::text) > (${sortOrderCursor}, ${idCursor})`,
        );
      }
    }
  }

  const orderBy = useRecent
    ? [
        desc(sql`COALESCE(${templates.publishedAt}, ${templates.createdAt})`),
        desc(templates.id),
      ]
    : [desc(templates.featured), asc(templates.sortOrder), asc(templates.id)];

  const rows = await c.var.db
    .select()
    .from(templates)
    .where(and(...whereParts))
    .orderBy(...orderBy)
    .limit(q.limit + 1);

  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? useRecent
        ? `${(last.publishedAt ?? last.createdAt).toISOString()}::${last.id}`
        : `${last.sortOrder}:${last.id}`
      : null;

  const publicBaseUrl = new URL(c.req.url).origin;
  const data = page.map((row) =>
    templateToMobileDTO(row, {
      publicBaseUrl,
    }),
  );

  c.header('Cache-Control', PUBLIC_CACHE_HEADERS['Cache-Control']);
  return c.json({ data, nextCursor });
});

/**
 * GET /v1/catalog/sections
 *
 * Composite home-screen layout. Returns a stack of rails the mobile
 * app renders directly. See `lib/section-builder.ts` for the rule
 * set; the route itself is a thin wrapper that handles caching.
 *
 * Optional `?categoryId=` scopes the response to a single category —
 * powers the chip filter on the home screen. The empty string and
 * the literal `'all'` are treated as "no filter".
 *
 * Edge cache cardinality is bounded by `1 + N` where N is the count
 * of categories. Plenty cheap for Cloudflare's PoPs.
 */
const sectionsQuerySchema = z.object({
  categoryId: z.string().optional(),
});

catalog.get(
  '/sections',
  withRateLimit((env) => env.RL_PUBLIC_IP, byIp),
  zValidator('query', sectionsQuerySchema),
  async (c) => {
  const { categoryId } = c.req.valid('query');
  const publicBaseUrl = new URL(c.req.url).origin;
  const sections = await buildHomeSections(c.var.db, {
    publicBaseUrl,
    categoryId,
  });
  c.header('Cache-Control', PUBLIC_CACHE_HEADERS['Cache-Control']);
  return c.json({ sections });
});

// Validate the param up-front so an obviously-malformed id surfaces as
// a 400 rather than a Postgres `invalid input syntax for uuid` 500.
const idParamSchema = z.object({ id: z.string().uuid() });

catalog.get(
  '/templates/:id',
  withAuth({ required: false }),
  withRateLimit((env) => env.RL_PUBLIC_IP, byIp),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await c.var.db.query.templates.findFirst({
      where: and(eq(templates.id, id), eq(templates.status, 'published')),
    });
    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
    }

    const publicBaseUrl = new URL(c.req.url).origin;

    // Resolve favorite state when the caller is authenticated.
    // Anonymous reads still hit the edge cache; authed responses
    // bypass the shared cache because the body now varies per user.
    let isFavorited: boolean | undefined;
    const clerkUserId = c.var.clerkUserId;
    if (clerkUserId) {
      const userRow = await c.var.db.query.users.findFirst({
        where: eq(users.clerkUserId, clerkUserId),
        columns: { id: true },
      });
      if (userRow) {
        const saved = await c.var.db.query.savedTemplates.findFirst({
          where: and(
            eq(savedTemplates.userId, userRow.id),
            eq(savedTemplates.templateId, id),
          ),
          columns: { templateId: true },
        });
        isFavorited = Boolean(saved);
      }
      // No shared edge cache for personalised bodies; mobile's
      // React-Query layer is the real cache here.
      c.header('Cache-Control', 'private, max-age=10');
    } else {
      c.header('Cache-Control', PUBLIC_CACHE_HEADERS['Cache-Control']);
    }

    return c.json({
      data: {
        ...templateToMobileDTO(row, {
          publicBaseUrl,
        }),
        isFavorited,
      },
    });
  },
);

// ─── Favorites ──────────────────────────────────────────────────────
//
// POST   /v1/catalog/templates/:id/favorite   — save (idempotent)
// DELETE /v1/catalog/templates/:id/favorite   — unsave (idempotent)
//
// Both endpoints are auth-required and resolve the user via the
// Clerk subject. The composite PK on `saved_templates` makes both
// operations idempotent at the SQL layer (`ON CONFLICT DO NOTHING`
// for insert; row-not-found for delete is a 204 not an error).

catalog.post(
  '/templates/:id/favorite',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const clerkUserId = c.var.clerkUserId!;

    const userRow = await c.var.db.query.users.findFirst({
      where: eq(users.clerkUserId, clerkUserId),
      columns: { id: true },
    });
    if (!userRow) {
      return c.json(
        { error: { code: 'user_not_provisioned', message: 'Account not provisioned.' } },
        401,
      );
    }

    // Verify the template exists + is published before recording the
    // save — keeps the table clean of orphan references.
    const tpl = await c.var.db.query.templates.findFirst({
      where: and(eq(templates.id, id), eq(templates.status, 'published')),
      columns: { id: true },
    });
    if (!tpl) {
      return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
    }

    await c.var.db
      .insert(savedTemplates)
      .values({ userId: userRow.id, templateId: id })
      .onConflictDoNothing();

    return c.json({ data: { templateId: id, isFavorited: true } });
  },
);

catalog.delete(
  '/templates/:id/favorite',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const clerkUserId = c.var.clerkUserId!;

    const userRow = await c.var.db.query.users.findFirst({
      where: eq(users.clerkUserId, clerkUserId),
      columns: { id: true },
    });
    if (!userRow) {
      return c.json(
        { error: { code: 'user_not_provisioned', message: 'Account not provisioned.' } },
        401,
      );
    }

    await c.var.db
      .delete(savedTemplates)
      .where(
        and(
          eq(savedTemplates.userId, userRow.id),
          eq(savedTemplates.templateId, id),
        ),
      );

    return c.json({ data: { templateId: id, isFavorited: false } });
  },
);
