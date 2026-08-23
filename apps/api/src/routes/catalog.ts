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
import type { MediaRef, UserLocale } from '@clickfy/types';
import type { MobileHomeBanner } from '@clickfy/types';

import {
  cursorForRow,
  decodeCursor,
  keysetAfter,
  orderByFor,
  selectionFor,
  type SortKey,
} from '../lib/catalog-cursor';
import type { AppEnv } from '../types';
import { resolveOwnMediaUrl, templateToMobileDTO } from '../lib/template-dto';
import {
  loadTemplateCategories,
  loadTemplateCategoriesMap,
  templateInCategoryTree,
} from '../lib/template-categories';
import { buildHomeSections } from '../lib/section-builder';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
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

/**
 * Resolve the request locale from the `?locale=` query param.
 *
 * Defaults to `'en'` and only switches on an exact `'ar'` — any other
 * value (including absent/garbage) safely yields English. The param
 * lives in the URL on purpose: the edge cache keys on the full URL, so
 * `?locale=ar` is cached as a distinct entry and Arabic responses never
 * poison the English cache (or vice-versa). An `Accept-Language` header
 * would NOT vary the cache and is therefore deliberately not used.
 */
function resolveLocale(raw: string | undefined): UserLocale {
  return raw === 'ar' ? 'ar' : 'en';
}

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
  kind: z.enum(['image', 'video', 'image_set', 'video_image']).optional(),
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
  /**
   * Target locale for user-facing copy. `'ar'` resolves Arabic content
   * (with English fallback per field); anything else is English. Kept
   * in the query string so it participates in the edge-cache key.
   */
  locale: z.enum(['en', 'ar']).optional(),
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

  // ── Sort keys ────────────────────────────────────────────────
  //
  // Declared ONCE per mode. `orderByFor`, `keysetAfter` and the cursor
  // encoding are all derived from the same list, so the ordering and
  // the predicate that pages it cannot drift apart — which is exactly
  // how `default` came to terminate after 73 of 271 rows, and how
  // `popular` came to compare its id tiebreaker backwards.
  //
  // Every expression here is NOT NULL or COALESCE-wrapped; a NULL key
  // makes the keyset predicate NULL and drops the row from every later
  // page. See lib/catalog-cursor.ts.
  const useRecent = q.sort === 'recent';
  const usePopular = q.sort === 'popular';

  // Publication instant, with the legacy-row fallback the old `recent`
  // ordering already used. `created_at` is NOT NULL, so this is total.
  const pubExpr = sql`COALESCE(${templates.publishedAt}, ${templates.createdAt})`;
  const runsExpr = sql`COALESCE((${templates.stats}->>'runs')::int, 0)`;

  // When a search term is set we fold a small relevance score into the
  // default ordering: exact title match first (rank 0), then prefix
  // match (rank 1), then everything else (rank 2). Only on the default
  // sort — `recent` is explicitly recency-ordered and people expect
  // that even when a query is set.
  const searchTerm = q.search?.trim() ?? '';
  const useSearchRank = !useRecent && !usePopular && searchTerm.length > 0;
  const rankExpr = sql<number>`CASE
        WHEN LOWER(${templates.title}) = LOWER(${searchTerm}) THEN 0
        WHEN LOWER(${templates.title}) LIKE LOWER(${searchTerm + '%'}) THEN 1
        ELSE 2
      END`;

  const K = {
    rank: {
      expr: rankExpr,
      dir: 'asc',
      as: 'k_rank',
      selectExpr: sql<number>`(${rankExpr})::int`,
      bind: (v) => sql`${Number(v)}::int`,
    },
    runs: {
      expr: runsExpr,
      dir: 'desc',
      as: 'k_runs',
      selectExpr: sql<number>`(${runsExpr})::int`,
      bind: (v) => sql`${Number(v)}::int`,
    },
    featured: {
      expr: sql`${templates.featured}`,
      dir: 'desc',
      as: 'k_featured',
      selectExpr: sql<boolean>`${templates.featured}`,
      bind: (v) => sql`${Boolean(v)}::boolean`,
    },
    sortOrder: {
      expr: sql`${templates.sortOrder}`,
      dir: 'asc',
      as: 'k_sort_order',
      selectExpr: sql<number>`${templates.sortOrder}`,
      bind: (v) => sql`${Number(v)}::int`,
    },
    // Newest first. This is the fix for the ordering itself: every
    // published row carries sort_order = 0, so before this the only
    // effective tiebreaker was `id` — a random uuid — and the catalog
    // came back in arbitrary order with new templates buried anywhere.
    //
    // Selected as `::text` for full microsecond precision; a JS Date
    // rounds to milliseconds and the resulting cursor would skip every
    // row inside that sub-millisecond window.
    published: {
      expr: pubExpr,
      dir: 'desc',
      as: 'k_published',
      selectExpr: sql<string>`(${pubExpr})::text`,
      bind: (v) => sql`${String(v)}::timestamptz`,
    },
    // Final tiebreaker, purely so the ordering is total and the cursor
    // deterministic. Compared AS UUID, matching the ORDER BY — the old
    // predicate cast to text, which agrees only because this database
    // happens to collate C.UTF-8.
    id: {
      expr: sql`${templates.id}`,
      dir: 'asc',
      as: 'k_id',
      selectExpr: sql<string>`${templates.id}::text`,
      bind: (v) => sql`${String(v)}::uuid`,
    },
  } satisfies Record<string, SortKey>;

  // The curated chain, shared by `default` and by `popular`'s
  // tiebreakers so a catalog with no engagement data still orders
  // editorially rather than at random.
  const curated: SortKey[] = [K.featured, K.sortOrder, K.published, K.id];

  const sortKeys: SortKey[] = useRecent
    ? [K.published, K.id]
    : usePopular
      ? [K.runs, ...curated]
      : useSearchRank
        ? [K.rank, ...curated]
        : curated;

  // The cursor is bound to the key SHAPE, not just the sort name, so a
  // token minted with a search term active can never be replayed
  // against the unranked ordering (or vice versa).
  const cursorMode = `${q.sort ?? 'default'}${useSearchRank ? '+rank' : ''}`;

  const whereParts: SQL[] = [...filterParts];
  const cursorValues = decodeCursor(q.cursor, cursorMode, sortKeys.length);
  if (cursorValues) {
    const after = keysetAfter(sortKeys, cursorValues);
    if (after) whereParts.push(after);
  }

  const orderBy = orderByFor(sortKeys);

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

  // Each sort key also selects its own value under `k_*`, so the cursor
  // is minted from exactly what the database ordered by rather than
  // from a JS re-derivation of it.
  const [rows, total] = await Promise.all([
    c.var.db
      .select({ row: templates, ...selectionFor(sortKeys) })
      .from(templates)
      .where(and(...whereParts))
      .orderBy(...orderBy)
      .limit(q.limit + 1),
    countPromise,
  ]);

  const hasMore = rows.length > q.limit;
  const pageRows = hasMore ? rows.slice(0, q.limit) : rows;
  const page = pageRows.map((r) => r.row);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? cursorForRow(cursorMode, sortKeys, last as Record<string, unknown>) : null;

  const publicBaseUrl = new URL(c.req.url).origin;
  const locale = resolveLocale(q.locale);
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
      locale,
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
  locale: z.enum(['en', 'ar']).optional(),
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
    locale: resolveLocale(c.req.valid('query').locale),
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
  const locale = resolveLocale(c.req.query('locale'));

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
    .map((row) => bannerToMobileDTO(row, publicBaseUrl, locale))
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
  locale: UserLocale = 'en',
): MobileHomeBanner | null {
  const media = (row.media ?? []) as MediaRef[];
  if (media.length === 0) return null;

  // Per-locale overrides with English (the canonical columns) as the
  // fallback for any field the translation omits.
  const tx = locale !== 'en' ? (row.translations?.[locale] ?? undefined) : undefined;
  const title = tx?.title ?? row.title;
  const subtitle = tx?.subtitle ?? row.subtitle;
  const ctaLabel = tx?.ctaLabel ?? row.ctaLabel;

  const cta = {
    kind: row.ctaKind,
    target: row.ctaTarget ?? null,
    label: ctaLabel ?? null,
  };
  const base = {
    id: row.id,
    title,
    subtitle,
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
          locale: resolveLocale(c.req.query('locale')),
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
// Both endpoints are auth-required and resolve the user through
// `withCurrentUser()` — the one place that also rejects soft-deleted
// accounts (a Clerk session can outlive the delete). The composite PK
// on `saved_templates` makes both operations idempotent at the SQL
// layer (`ON CONFLICT DO NOTHING` for insert; row-not-found for
// delete is a 204 not an error).

catalog.post(
  '/templates/:id/favorite',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const userRow = c.var.user!;

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
  withCurrentUser(),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const userRow = c.var.user!;

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
