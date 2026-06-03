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

import { homeBanners, savedTemplates, templates, users } from '@clickfy/db';
import type { MediaRef } from '@clickfy/types';
import type { MobileHomeBanner } from '@clickfy/types';

import type { AppEnv } from '../types';
import { resolveOwnMediaUrl, templateToMobileDTO } from '../lib/template-dto';
import {
  loadTemplateCategories,
  loadTemplateCategoriesMap,
  templateInCategoryTree,
} from '../lib/template-categories';
import { buildHomeSections } from '../lib/section-builder';
import { withAuth } from '../middleware/with-auth';
import { withEdgeCache } from '../middleware/with-edge-cache';
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
   *                                   When a `search` term is set we
   *                                   first sort by match quality
   *                                   (exact > starts-with > contains),
   *                                   then fall back to the same chain.
   *                                   Best for human-curated rails.
   *   - `recent`                   — most recently published first.
   *                                   Used by mobile "New Arrivals" etc.
   *   - `popular`                  — most-used first. Reads
   *                                   `stats->>'runs'` (cast to int)
   *                                   and falls back to the curated
   *                                   chain (featured/sortOrder/id) so
   *                                   the option still produces a sane
   *                                   ordering before any engagement
   *                                   data is logged.
   */
  sort: z.enum(['default', 'recent', 'popular']).optional(),
  /**
   * When `true`, the response carries a `meta.total` count of the rows
   * matching the WHERE clause (ignoring cursor/limit). Used by the
   * mobile filter sheet's sticky "Show X results" button. We make this
   * opt-in because the extra `COUNT(*)` doubles the per-request DB
   * round-trips — fine for the filter sheet but wasted work on rail
   * fetches that don't need it.
   */
  withCount: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === true || v === 'true'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

catalog.get(
  '/templates',
  withEdgeCache({ ttlSeconds: 60 }),
  withRateLimit((env) => env.RL_PUBLIC_IP, byIp),
  zValidator('query', listQuerySchema),
  async (c) => {
  const q = c.req.valid('query');

  // Filter predicates — what `withCount` should count against. We
  // deliberately keep this list disjoint from the cursor predicate so
  // the count reflects the *whole* result set, not just the rows past
  // the current page's cursor.
  const filterParts: SQL[] = [eq(templates.status, 'published')];
  if (q.search) filterParts.push(ilike(templates.title, `%${q.search}%`));
  if (q.kind) filterParts.push(eq(templates.kind, q.kind));
  // Many-to-many membership check; matches the primary OR any extra
  // on the chosen category OR any direct sub-category of it. Tapping
  // a root chip on mobile therefore aggregates the root's own
  // templates with those assigned to its sub-categories (the "parent
  // aggregation" decision from the sub-categories design doc).
  //
  // The tree variant collapses to a strict match when `categoryId` is
  // itself a leaf, so we don't need to dispatch on root-vs-leaf here.
  if (q.categoryId) filterParts.push(templateInCategoryTree(q.categoryId));
  if (q.featured !== undefined) filterParts.push(eq(templates.featured, q.featured));

  // Cursor format depends on the active sort. We keep them disjoint so
  // a cursor minted under one ordering can't accidentally page through
  // the other. The cursor always carries a stable tiebreaker (`id`).
  const useRecent = q.sort === 'recent';
  const usePopular = q.sort === 'popular';
  const whereParts: SQL[] = [...filterParts];

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
    } else if (usePopular) {
      // Cursor: `runs:sortOrder:id`. We page by descending runs first,
      // then ascending sortOrder, then id — same chain as orderBy below.
      const [runsRaw, sortOrderRaw, idCursor] = q.cursor.split(':');
      const runsCursor = Number.parseInt(runsRaw, 10);
      const sortOrderCursor = Number.parseInt(sortOrderRaw, 10);
      if (Number.isFinite(runsCursor) && Number.isFinite(sortOrderCursor) && idCursor) {
        whereParts.push(
          sql`(COALESCE((${templates.stats}->>'runs')::int, 0), -${templates.sortOrder}, ${templates.id}::text) < (${runsCursor}, -${sortOrderCursor}, ${idCursor})`,
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

  // When a search term is set we fold a small relevance score into the
  // default ordering: exact title match first (rank 0), then prefix
  // match (rank 1), then everything else (rank 2). The remaining
  // `featured / sortOrder` chain breaks ties so curated rails still
  // surface their hand-picked top entry. We only apply this on the
  // default sort — `recent` is explicitly recency-ordered and people
  // expect that even when a query is set.
  const searchTerm = q.search?.trim() ?? '';
  const useSearchRank = !useRecent && searchTerm.length > 0;
  const searchRank = useSearchRank
    ? sql<number>`CASE
        WHEN LOWER(${templates.title}) = LOWER(${searchTerm}) THEN 0
        WHEN LOWER(${templates.title}) LIKE LOWER(${searchTerm + '%'}) THEN 1
        ELSE 2
      END`
    : null;

  const orderBy = useRecent
    ? [
        desc(sql`COALESCE(${templates.publishedAt}, ${templates.createdAt})`),
        desc(templates.id),
      ]
    : usePopular
      ? [
          // Most-used first. Coerce the JSONB value through `text` ->
          // `int` so a missing key (or null) sorts as 0 rather than
          // breaking the comparison.
          desc(sql`COALESCE((${templates.stats}->>'runs')::int, 0)`),
          // Tiebreakers — same chain the curated default uses, so a
          // brand-new catalog (all runs == 0) still produces an
          // editorially sensible order instead of an arbitrary one.
          desc(templates.featured),
          asc(templates.sortOrder),
          asc(templates.id),
        ]
      : useSearchRank
        ? [asc(searchRank!), desc(templates.featured), asc(templates.sortOrder), asc(templates.id)]
        : [desc(templates.featured), asc(templates.sortOrder), asc(templates.id)];

  // Run the count in parallel with the page fetch when requested.
  // `filterParts` excludes the cursor predicate so we count the
  // *full* result set, not just rows past the current page.
  const countPromise = q.withCount
    ? c.var.db
        .select({ count: sql<number>`count(*)::int` })
        .from(templates)
        .where(and(...filterParts))
        .then((r) => r[0]?.count ?? 0)
    : Promise.resolve(undefined);

  const [rows, total] = await Promise.all([
    c.var.db
      .select()
      .from(templates)
      .where(and(...whereParts))
      .orderBy(...orderBy)
      .limit(q.limit + 1),
    countPromise,
  ]);

  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? useRecent
        ? `${(last.publishedAt ?? last.createdAt).toISOString()}::${last.id}`
        : usePopular
          ? `${last.stats?.runs ?? 0}:${last.sortOrder}:${last.id}`
          : `${last.sortOrder}:${last.id}`
      : null;

  const publicBaseUrl = new URL(c.req.url).origin;
  // Bulk-load category memberships so we can hand each DTO its
  // ordered `[primary, …extras]` list without an N+1.
  const catsMap = await loadTemplateCategoriesMap(
    c.var.db,
    page.map((r) => r.id),
  );
  const data = page.map((row) =>
    templateToMobileDTO(row, {
      publicBaseUrl,
      categoryIds: catsMap.get(row.id)?.all ?? [],
    }),
  );

  c.header('Cache-Control', PUBLIC_CACHE_HEADERS['Cache-Control']);
  return c.json({
    data,
    nextCursor,
    ...(total !== undefined ? { meta: { total } } : {}),
  });
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
  withEdgeCache({ ttlSeconds: 60 }),
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

/**
 * GET /v1/catalog/banners
 *
 * Returns the banner strip rendered above the "Trending Now" rail on
 * the mobile home screen. Filtering rules:
 *
 *   - `is_active = true`
 *   - `starts_at IS NULL OR starts_at <= now()`
 *   - `ends_at   IS NULL OR ends_at   >= now()`
 *
 * Ordered by `sort_order ASC, created_at DESC` so admin's manual
 * order wins, with newest as a tiebreaker for equal sort_order.
 *
 * Cached `s-maxage=60` like the other public catalog endpoints — a
 * one-minute lag on a freshly-published banner is acceptable, and
 * banners change far less often than templates.
 */
catalog.get(
  '/banners',
  withEdgeCache({ ttlSeconds: 60 }),
  withRateLimit((env) => env.RL_PUBLIC_IP, byIp),
  async (c) => {
  const publicBaseUrl = new URL(c.req.url).origin;

  const rows = await c.var.db
    .select()
    .from(homeBanners)
    .where(
      and(
        eq(homeBanners.isActive, true),
        sql`(${homeBanners.startsAt} IS NULL OR ${homeBanners.startsAt} <= now())`,
        sql`(${homeBanners.endsAt}   IS NULL OR ${homeBanners.endsAt}   >= now())`,
      ),
    )
    .orderBy(asc(homeBanners.sortOrder), desc(homeBanners.createdAt));

  // Map to mobile DTO. Drop banners whose media list is empty (admin
  // misconfiguration); never ship a banner with nothing to render.
  const data = rows
    .map((row) => bannerToMobileDTO(row, publicBaseUrl))
    .filter((b): b is MobileHomeBanner => b !== null);

  c.header('Cache-Control', PUBLIC_CACHE_HEADERS['Cache-Control']);
  return c.json({ data });
});

/**
 * Resolve a stored banner row to the mobile DTO. Returns null when
 * the row's `media` array is empty (image/slider/video all require
 * at least one MediaRef) — the public list endpoint filters those
 * out so a misconfigured banner never reaches the phone.
 *
 * Why a function (not a method on the row): same reason as
 * `templateToMobileDTO` — single source of truth for the wire
 * shape, easy to test in isolation.
 */
function bannerToMobileDTO(
  row: typeof homeBanners.$inferSelect,
  publicBaseUrl: string,
): MobileHomeBanner | null {
  const media = (row.media ?? []) as MediaRef[];
  if (media.length === 0) return null;

  const cta = {
    kind: row.ctaKind,
    target: row.ctaTarget ?? null,
    label: row.ctaLabel ?? null,
  };
  const base = {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    cta,
  };

  if (row.kind === 'video') {
    const v = media[0]!;
    return {
      ...base,
      kind: 'video',
      video: {
        hlsUrl: resolveOwnMediaUrl(v, publicBaseUrl),
        // Banners don't carry a separate poster — the cover frame is
        // baked into the media itself. Use the same URL so the
        // player has something to draw before the first decoded frame.
        posterUrl: resolveOwnMediaUrl(v, publicBaseUrl),
        durationSec: 0,
      },
    };
  }

  const images = media.map((m) => ({
    url: resolveOwnMediaUrl(m, publicBaseUrl),
    width: m.width,
    height: m.height,
    blurhash: m.blurhash,
  }));

  if (row.kind === 'image_slider') {
    return { ...base, kind: 'image_slider', images };
  }
  // Default: 'image' — render the first MediaRef even if admin
  // somehow stored more than one (shouldn't happen given the form
  // constraint, but cheap to be tolerant).
  return { ...base, kind: 'image', image: images[0]! };
}

// Validate the param up-front so an obviously-malformed id surfaces as
// a 400 rather than a Postgres `invalid input syntax for uuid` 500.
const idParamSchema = z.object({ id: z.string().uuid() });

catalog.get(
  '/templates/:id',
  // Anonymous reads are share-cached at the edge; any request carrying a
  // bearer token skips the cache (inside withEdgeCache) so the
  // per-user `isFavorited` body is never cached or cross-served.
  withEdgeCache({ ttlSeconds: 60 }),
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
    //
    // Perf: the category load and the favorite resolution are
    // independent of each other, so we fire them concurrently instead
    // of stacking sequential Neon HTTP round-trips. The favorite branch
    // still resolves the user → saved row in order (the saved lookup
    // needs the user id), but that whole branch now overlaps the
    // category fetch — shaving a full round-trip off every authed
    // detail open.
    const clerkUserId = c.var.clerkUserId;

    const favoritedPromise: Promise<boolean | undefined> = clerkUserId
      ? (async () => {
          const userRow = await c.var.db.query.users.findFirst({
            where: eq(users.clerkUserId, clerkUserId),
            columns: { id: true },
          });
          if (!userRow) return undefined;
          const saved = await c.var.db.query.savedTemplates.findFirst({
            where: and(
              eq(savedTemplates.userId, userRow.id),
              eq(savedTemplates.templateId, id),
            ),
            columns: { templateId: true },
          });
          return Boolean(saved);
        })()
      : Promise.resolve(undefined);

    const [cats, isFavorited] = await Promise.all([
      loadTemplateCategories(c.var.db, row.id),
      favoritedPromise,
    ]);

    if (clerkUserId) {
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
          categoryIds: cats?.all ?? [],
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
