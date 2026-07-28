/**
 * /v1/admin/templates — template CRUD for the admin dashboard.
 *
 * Mirrors the conventions established in `routes/categories.ts`:
 *   - Read endpoints are public so the dashboard can call them with a
 *     plain session token (no extra entitlement check) and the listing
 *     can be reused if we ever want server-rendered marketing pages.
 *     Mutations require `withAdmin()`.
 *   - `POST /reorder` is defined BEFORE `/:id` so Hono matches the
 *     literal path first.
 *   - Publish snapshots a full row into `template_versions` (incrementing
 *     the per-template version counter) so a user's job record always
 *     points at the exact recipe that produced its result.
 *
 * Slug derivation: if the admin form omits `slug`, we generate it from
 * the title (lowercase, hyphenated). A 409 surfaces when the slug
 * collides with an existing template — admin form retries with a
 * suggested suffix.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, ilike, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { jobs, templateVersions, templates, type Template } from '@clickfy/db';
import { findCapabilities } from '@clickfy/providers';

import type { AppEnv } from '../types';
import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { computeTemplateCost } from '../lib/template-cost';
import {
  insertTemplateCategories,
  loadTemplateCategories,
  loadTemplateCategoriesMap,
  replaceTemplateCategories,
  templateInCategory,
  validateCategorySet,
} from '../lib/template-categories';
import {
  createTemplateSchema,
  publishTemplateSchema,
  reorderTemplatesSchema,
  templateKindSchema,
  templateStatusSchema,
  updateTemplateSchema,
} from '../lib/template-schemas';

export const templatesRoute = new Hono<AppEnv>();

/**
 * Resolve the (primaryCategoryId, extraCategoryIds) pair from a
 * create/update body, accepting both the new explicit fields and the
 * legacy `categoryId` field so a stale admin bundle keeps working
 * across a deploy. Returns `null` when nothing was sent (legitimate
 * on a PATCH that doesn't touch categories).
 */
function resolveCategoryFields(body: {
  primaryCategoryId?: string;
  extraCategoryIds?: string[];
  categoryId?: string;
}): { primary: string; extras: string[] } | null {
  const primary = body.primaryCategoryId ?? body.categoryId;
  if (!primary) return null;
  return { primary, extras: body.extraCategoryIds ?? [] };
}

/**
 * Attach the `categoryIds` / `primaryCategoryId` / `extraCategoryIds`
 * trio to a raw `Template` row so the admin response carries
 * everything the editor needs. Centralised so all read endpoints
 * agree on the shape.
 */
type AdminTemplateRow = Template & {
  categoryId: string;
  primaryCategoryId: string;
  extraCategoryIds: string[];
  categoryIds: string[];
};

function attachAdminCategoryFields(
  row: Template,
  ordered: { primary: string; extras: string[]; all: string[] } | null,
): AdminTemplateRow {
  const primary = ordered?.primary ?? '';
  const extras = ordered?.extras ?? [];
  const all = ordered?.all ?? [];
  return {
    ...row,
    categoryId: primary,
    primaryCategoryId: primary,
    extraCategoryIds: extras,
    categoryIds: all,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Strip authoring-only working state from generation references
 * before we persist a template row. The admin form *should* already
 * upload reference images to R2 and only send `r2Key`, but Zod still
 * accepts the legacy `base64 / mimeType / fileName / label` fields
 * for round-trip with older clients. We drop them here so the JSONB
 * column stays compact (a few hundred bytes per reference instead of
 * megabytes if base64 ever slipped through).
 */
type GenerationLike = {
  mode: 'image' | 'video' | 'image_then_video';
  stages: Array<{
    id: string;
    order: number;
    provider: 'gemini' | 'kling' | 'seedance';
    model: string;
    prompt: string;
    references: Array<{
      id: string;
      key: string;
      role: 'style' | 'composition' | 'lighting' | 'scene' | 'example';
      r2Key?: string;
      base64?: string;
      mimeType?: string;
      fileName?: string;
      label?: string;
    }>;
    config: Record<string, unknown>;
    retry: { enabled: boolean; maxAttempts: number; fallbackModel?: string };
  }>;
};

/**
 * Derive the user-facing output shape from the stages array.
 *
 * Why: the admin form has no UI for `generation.mode` or
 * `output.type`, so both default to `'image'` even when the user
 * builds a 2-stage `image_then_video` pipeline. That mismatch
 * caused jobs to complete with zero outputs because the
 * orchestrator's strict filter returned nothing.
 *
 * Source of truth is the stages array — each stage references a
 * model whose `capabilities.kind` ('image' | 'video') tells us
 * exactly what that stage emits. We compute everything from there:
 *
 *   • mode:
 *     - all image     → 'image'
 *     - all video     → 'video'
 *     - image → video → 'image_then_video'
 *
 *   • output.type:
 *     - mode 'image'             → 'image'
 *     - mode 'video'             → 'video'
 *     - mode 'image_then_video'  → 'both'
 *
 *   • output.count:
 *     - sum of `stage.config.numberOfOutputs` for the user-facing
 *       stages (final stage for image/video, all stages for both)
 *
 * Existing admin-provided values are *overwritten* — we treat the
 * stages as canonical because the admin can't edit anything else
 * about output today. When we build a proper Output settings UI,
 * this helper becomes a fallback for missing fields instead.
 */
function deriveGenerationAndOutput(
  generation: GenerationLike,
  existingOutput?: { type?: string; count?: number; format?: string; allowRegeneration?: boolean; watermark?: string },
): { generation: GenerationLike; output: { type: 'image' | 'video' | 'both'; count: number; format: string; allowRegeneration: boolean; watermark?: 'always' | 'free_only' | 'never' } } {
  const stages = [...generation.stages].sort((a, b) => a.order - b.order);

  // Look up each stage's media kind. The capabilities registry is
  // the authoritative source, but admin-saved model ids sometimes
  // drift from the registry (hyphen-vs-dot in version numbers, new
  // models added before the catalog refresh, etc.). Falling back
  // to the provider name when the model lookup misses keeps the
  // derivation correct: every Kling model is video, everything
  // else in the current catalog (Gemini, OpenAI image, Imagen) is
  // image.
  const kinds: Array<'image' | 'video'> = stages.map((stage) => {
    const cap = findCapabilities(stage.model);
    if (cap) return cap.kind;
    if (stage.provider === 'kling' || stage.provider === 'seedance') return 'video';
    return 'image';
  });
  const hasImage = kinds.includes('image');
  const hasVideo = kinds.includes('video');

  let mode: GenerationLike['mode'];
  if (hasImage && hasVideo) {
    mode = 'image_then_video';
  } else if (hasVideo) {
    mode = 'video';
  } else {
    mode = 'image';
  }

  const outputType: 'image' | 'video' | 'both' =
    mode === 'image_then_video' ? 'both' : mode;

  // For `both`, the user sees one of each — that's the
  // `image_then_video` convention (still + animated video derived
  // from it). For pure image/video pipelines, the per-stage
  // numberOfOutputs of the final stage determines the count.
  let count: number;
  if (outputType === 'both') {
    count = 2;
  } else {
    const finalStage = stages[stages.length - 1];
    const raw = finalStage?.config?.numberOfOutputs;
    count = typeof raw === 'number' && raw > 0 ? Math.trunc(raw) : 1;
  }

  return {
    generation: { ...generation, mode },
    output: {
      type: outputType,
      count,
      format: existingOutput?.format ?? 'png',
      allowRegeneration: existingOutput?.allowRegeneration ?? true,
      ...(existingOutput?.watermark
        ? { watermark: existingOutput.watermark as 'always' | 'free_only' | 'never' }
        : {}),
    },
  };
}

function sanitizeGenerationForPersist(generation: GenerationLike): GenerationLike {
  return {
    mode: generation.mode,
    stages: generation.stages.map((stage) => ({
      ...stage,
      references: stage.references.map((ref) => {
        const clean: GenerationLike['stages'][number]['references'][number] = {
          id: ref.id,
          key: ref.key,
          role: ref.role,
        };
        if (ref.r2Key) clean.r2Key = ref.r2Key;
        // `label` is admin-facing freeform caption; it's part of the
        // canonical shape so we keep it. base64/mimeType/fileName are
        // transient working state and are intentionally dropped.
        if (ref.label && ref.label.length > 0) clean.label = ref.label;
        return clean;
      }),
    })),
  };
}

/**
 * Turn a title into a URL-safe slug. Mirrors the convention used by
 * the admin form's auto-derivation so server and client agree on the
 * shape (purely lowercase a-z 0-9 with single hyphens between words).
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || `template-${Date.now().toString(36)}`;
}

/**
 * Append `-2`, `-3`, … to the slug until it doesn't collide. Cheap
 * because we expect the first or second attempt to win in 99% of
 * cases.
 */
async function uniqueSlug(
  db: AppEnv['Variables']['db'],
  base: string,
  excludeId?: string,
): Promise<string> {
  // Pull every template whose slug starts with the base — usually 0 or 1.
  const matches = await db
    .select({ slug: templates.slug, id: templates.id })
    .from(templates)
    .where(ilike(templates.slug, `${base}%`));
  const taken = new Set(
    matches.filter((m) => m.id !== excludeId).map((m) => m.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Astronomically unlikely. Fall back to a random suffix.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Read (admin-only — listing includes drafts) ────────────────────

/**
 * GET /v1/admin/templates
 *
 * Filters (all optional, all combinable):
 *   - search          — substring match on `title` (case-insensitive)
 *   - status          — draft | published | archived
 *   - kind            — image | video | image_set
 *   - categoryId
 *   - includeArchived — `true` to include archived rows when no
 *                       explicit `status` is set. Default `false`.
 *   - sort            — newest (default) | oldest | title_asc | manual
 *   - limit           — 1..100, default 50
 *   - offset          — >=0, default 0
 *
 * Ordering (`sort`):
 *   - `newest` (default) — most recent first, keyed on
 *     `COALESCE(publishedAt, createdAt)`. Published rows sort by when
 *     they were published; drafts by when they were created. This is
 *     what "show published newest → oldest" means for the admin grid.
 *   - `oldest`           — the same key, ascending.
 *   - `title_asc`        — alphabetical by title (A→Z).
 *   - `manual`           — the curated `sortOrder` used by the public
 *     catalog, exposed here so the admin can preview catalog order.
 * `id` is always the final tiebreaker so paging is deterministic.
 *
 * Pagination is offset-based (`limit` / `offset`) and the response
 * carries `meta.total` (the full count for the active filter set) so
 * the dashboard can render "X templates" and a Load-more control.
 * Offset paging — rather than the catalog's keyset cursor — keeps the
 * handler simple across the four sort orders; the admin is a low-
 * traffic internal tool where the slight row-drift risk under
 * concurrent edits is irrelevant.
 *
 * Archived visibility — archived templates are hidden from the
 * default response so the admin's primary working view stays clean.
 * To see them you either:
 *   - pass `status=archived` (returns ONLY archived rows), or
 *   - pass `includeArchived=true` (mixes archived in with everything
 *     else, useful for "show all, including archived" mode).
 * The two flags are independent; passing both is fine and `status`
 * always wins.
 *
 * Auth: admin-only because the listing includes drafts. The mobile-
 * facing equivalent is `/v1/catalog/templates`, which is unauth-
 * enticated and only returns published rows.
 */
const listQuerySchema = z.object({
  search: z.string().max(120).optional(),
  status: templateStatusSchema.optional(),
  kind: templateKindSchema.optional(),
  categoryId: z.string().uuid().optional(),
  // Coerce common truthy strings — Zod's `boolean()` only accepts a
  // literal boolean, but query strings are always strings.
  includeArchived: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  sort: z.enum(['newest', 'oldest', 'title_asc', 'manual']).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

templatesRoute.get(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('query', listQuerySchema),
  async (c) => {
  const q = c.req.valid('query');
  const whereParts: SQL[] = [];

  if (q.search) whereParts.push(ilike(templates.title, `%${q.search}%`));
  if (q.status) {
    // Explicit status wins — the admin asked for exactly these rows
    // (including the case `status=archived`, which is how the
    // "Archived" filter chip surfaces archived templates).
    whereParts.push(eq(templates.status, q.status));
  } else if (!q.includeArchived) {
    // Default working view: hide archived. Admins see drafts +
    // published only unless they explicitly opt in.
    whereParts.push(ne(templates.status, 'archived'));
  }
  if (q.kind) whereParts.push(eq(templates.kind, q.kind));
  // Match the primary OR any extra category — same predicate the
  // public catalog uses, so admin filters mirror what the user sees.
  if (q.categoryId) whereParts.push(templateInCategory(q.categoryId));

  const whereClause = whereParts.length > 0 ? and(...whereParts) : undefined;

  // Recency axis: a published row's publish time, falling back to
  // creation time for drafts (which have no `publishedAt`).
  const recencyKey = sql`COALESCE(${templates.publishedAt}, ${templates.createdAt})`;
  const orderBy =
    q.sort === 'oldest'
      ? [asc(recencyKey), asc(templates.id)]
      : q.sort === 'title_asc'
        ? [asc(templates.title), asc(templates.id)]
        : q.sort === 'manual'
          ? [asc(templates.sortOrder), asc(templates.id)]
          : // newest (default)
            [desc(recencyKey), desc(templates.id)];

  // Page + full count run concurrently — the count powers the
  // "X templates" header and the Load-more affordance, and reflects
  // the whole filtered set (it shares `whereClause`, which has no
  // pagination predicate).
  const [rows, totalRes] = await Promise.all([
    c.var.db
      .select()
      .from(templates)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(q.limit)
      .offset(q.offset),
    c.var.db
      .select({ count: sql<number>`count(*)::int` })
      .from(templates)
      .where(whereClause),
  ]);

  const total = totalRes[0]?.count ?? 0;
  const hasMore = q.offset + rows.length < total;

  // Bulk-load category memberships for this page and decorate each
  // row with the legacy `categoryId` (= primary) plus the new
  // `primaryCategoryId` / `extraCategoryIds` / `categoryIds` fields.
  const catsMap = await loadTemplateCategoriesMap(
    c.var.db,
    rows.map((r) => r.id),
  );
  const data = rows.map((row) =>
    attachAdminCategoryFields(row, catsMap.get(row.id) ?? null),
  );

  return c.json({
    data,
    meta: { total, limit: q.limit, offset: q.offset, hasMore },
  });
  },
);

// Guard parameterised admin routes with the same UUID check the
// catalog uses. Returns 400 on malformed ids rather than letting
// Postgres throw a generic 500.
const idParamSchema = z.object({ id: z.string().uuid() });

templatesRoute.get(
  '/:id',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await c.var.db.query.templates.findFirst({
      where: eq(templates.id, id),
    });
    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
    }
    const cats = await loadTemplateCategories(c.var.db, id);
    return c.json({ data: attachAdminCategoryFields(row, cats) });
  },
);

// ─── Bulk reorder (admin) ───────────────────────────────────────────

templatesRoute.post(
  '/reorder',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('json', reorderTemplatesSchema),
  async (c) => {
    const { ids } = c.req.valid('json');

    // Single CASE statement → atomic reorder; same pattern as
    // `categories.reorder`. Drizzle parameterises every id, no
    // string concatenation, safe from injection.
    const chunks = ids.map((id, idx) => sql`when ${templates.id} = ${id} then ${idx}`);
    const caseExpr = sql.join(
      [sql`case`, ...chunks, sql`else ${templates.sortOrder} end`],
      sql.raw(' '),
    );

    await c.var.db
      .update(templates)
      .set({ sortOrder: caseExpr, updatedAt: new Date() })
      .where(inArray(templates.id, ids));

    c.set('audit', { metadata: { action: 'reorder', count: ids.length } });

    return c.json({ data: { reordered: ids.length } });
  },
);

// ─── Publish / Unpublish ────────────────────────────────────────────

/**
 * POST /v1/admin/templates/:id/publish
 *
 * Two-step transaction:
 *   1. Increment the per-template version counter and append the
 *      current row state to `template_versions`.
 *   2. Flip the template row to `published` and record `publishedAt`.
 *
 * The snapshot stores the full row as-is so future schema changes
 * don't retroactively rewrite history.
 */
templatesRoute.post(
  '/:id/publish',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('param', idParamSchema),
  zValidator('json', publishTemplateSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const adminUser = c.var.user;

    const row = await c.var.db.query.templates.findFirst({
      where: eq(templates.id, id),
    });
    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
    }

    // Load current category memberships up-front so we can both gate
    // the publish on "must have a primary category" and embed them in
    // the snapshot below.
    const cats = await loadTemplateCategories(c.var.db, id);

    // ── Publish-readiness guard ───────────────────────────────────────
    // The mobile catalog assumes published templates always have a
    // cover image, a primary category, and at least one generation
    // stage. We allow drafts to skip those, so the only place to
    // enforce them is right here. Collect every missing requirement
    // and return them all at once so the admin doesn't have to play
    // whack-a-mole.
    const missing: string[] = [];
    if (!row.coverMedia) missing.push('a cover image');
    if (!cats?.primary) missing.push('a primary category');
    const stageCount = row.generation?.stages?.length ?? 0;
    if (stageCount === 0) missing.push('at least one generation stage');
    if (missing.length > 0) {
      return c.json(
        {
          error: {
            code: 'not_ready_to_publish',
            message: `This template can't be published yet — it's missing ${missing.join(', ')}.`,
            details: { missing },
          },
        },
        400,
      );
    }

    // Next version number — read current max, increment. Uniqueness is
    // enforced by the `(template_id, version_number)` unique index, so
    // a concurrent publish on the same template would surface as a
    // constraint error here (uncommon enough in practice).
    const [{ nextVersion }] = await c.var.db
      .select({ nextVersion: sql<number>`coalesce(max(${templateVersions.versionNumber}), 0) + 1` })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, id));

    // Embed category memberships into the snapshot JSON so a future
    // "restore version N" can rebuild exactly what was published —
    // full-restore semantics per the design discussion.
    const snapshot = {
      ...row,
      primaryCategoryId: cats?.primary ?? '',
      extraCategoryIds: cats?.extras ?? [],
      categoryIds: cats?.all ?? [],
    };

    const publishedAt = new Date();
    await c.var.db.insert(templateVersions).values({
      templateId: id,
      versionNumber: nextVersion,
      snapshot,
      publishedBy: adminUser?.id ?? null,
      publishNote: body.publishNote ?? null,
      publishedAt,
    });

    const [updated] = await c.var.db
      .update(templates)
      .set({ status: 'published', publishedAt, updatedAt: publishedAt })
      .where(eq(templates.id, id))
      .returning();

    // Enrich the audit-log row the withAdmin middleware will write so the
    // monitoring activity feed reads "Published «Title» (v3)" instead of a
    // bare "POST /publish".
    c.set('audit', {
      resourceId: id,
      metadata: {
        action: 'publish',
        templateTitle: row.title,
        versionNumber: nextVersion,
        ...(body.publishNote ? { publishNote: body.publishNote } : {}),
      },
    });

    return c.json({ data: attachAdminCategoryFields(updated!, cats) });
  },
);

templatesRoute.post(
  '/:id/unpublish',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const [updated] = await c.var.db
      .update(templates)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(eq(templates.id, id))
      .returning();
    if (!updated) {
      return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
    }
    return c.json({ data: updated });
  },
);

// ─── Duplicate ──────────────────────────────────────────────────────

/**
 * POST /v1/admin/templates/:id/duplicate
 *
 * Clones every column except `id`, `slug`, `status`, `publishedAt`,
 * `lastTestedAt`, `stats`, `createdAt`, `updatedAt`. The clone always
 * starts as `draft` with stats zeroed out.
 */
templatesRoute.post(
  '/:id/duplicate',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const src = await c.var.db.query.templates.findFirst({
      where: eq(templates.id, id),
    });
    if (!src) {
      return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
    }

    // Copy categories alongside the row clone — the duplicate inherits
    // the same primary + extras. Loaded BEFORE the insert so the source
    // is unaffected by anything downstream. A category-less source
    // (legitimate for drafts) just produces a category-less clone.
    const srcCats = await loadTemplateCategories(c.var.db, id);

    const slug = await uniqueSlug(c.var.db, `${src.slug}-copy`);
    const [clone] = await c.var.db
      .insert(templates)
      .values({
        title: `${src.title} (Copy)`,
        slug,
        description: src.description,
        authorName: src.authorName,
        kind: src.kind,
        status: 'draft',
        featured: false,
        coverMedia: src.coverMedia,
        previewVideo: src.previewVideo,
        gallery: src.gallery,
        userInputs: src.userInputs,
        userCanChooseAspectRatio: src.userCanChooseAspectRatio,
        defaultAspectRatio: src.defaultAspectRatio,
        generation: src.generation,
        output: src.output,
        costCredits: src.costCredits,
        sortOrder: src.sortOrder + 1,
        // Carry over non-English overrides so a duplicate keeps its
        // Arabic (and any future locale) content.
        translations: src.translations,
      })
      .returning();

    if (!clone) {
      return c.json({ error: { code: 'create_failed', message: 'Failed to clone template.' } }, 500);
    }

    if (srcCats) {
      await insertTemplateCategories(c.var.db, clone.id, srcCats.primary, srcCats.extras);
    }

    return c.json({ data: attachAdminCategoryFields(clone, srcCats) }, 201);
  },
);

// ─── Write (admin) ──────────────────────────────────────────────────

templatesRoute.post(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('json', createTemplateSchema),
  async (c) => {
    const body = c.req.valid('json');

    // Categories are optional at create time — a draft can be saved
    // without one. If the admin DID send a category set, validate it
    // up-front (max 3, no overlap) so a bad payload doesn't burn a
    // slug + insert before failing.
    const catFields = resolveCategoryFields(body);
    if (catFields) {
      const valid = validateCategorySet({
        primaryCategoryId: catFields.primary,
        extraCategoryIds: catFields.extras,
      });
      if (!valid.ok) {
        return c.json({ error: { code: 'invalid_categories', message: valid.reason } }, 400);
      }
    }

    const slug = body.slug
      ? await uniqueSlug(c.var.db, body.slug)
      : await uniqueSlug(c.var.db, slugify(body.title));

    // Derive `generation.mode` and `output` from the stages array
    // because the admin form has no UI for those fields yet. See
    // `deriveGenerationAndOutput` for the rules.
    const sanitized = sanitizeGenerationForPersist(body.generation);
    const derived = deriveGenerationAndOutput(sanitized, body.output);

    // Auto-compute cost from per-stage model pricing — ignore any
    // costCredits the form sent (no manual override per the credit
    // system spec). Models with no price in provider_models contribute
    // 0; the admin UI surfaces the unpriced-models warning separately.
    const costBreakdown = await computeTemplateCost(c.var.db, derived.generation.stages);

    try {
      const [row] = await c.var.db
        .insert(templates)
        .values({
          title: body.title,
          slug,
          description: body.description,
          authorName: body.authorName,
          kind: body.kind,
          featured: body.featured,
          // `coverMedia` is now nullable — a draft can be created
          // without one. Coerce undefined to null so Drizzle sends
          // an explicit NULL instead of dropping the column.
          coverMedia: body.coverMedia ?? null,
          previewVideo: body.previewVideo ?? null,
          gallery: body.gallery,
          userInputs: body.userInputs,
          userCanChooseAspectRatio: body.userCanChooseAspectRatio,
          defaultAspectRatio: body.defaultAspectRatio ?? null,
          generation: derived.generation,
          output: derived.output,
          costCredits: costBreakdown.total,
          sortOrder: body.sortOrder,
          // Non-English overrides (optional). Coerce undefined to null so
          // Drizzle writes an explicit NULL rather than dropping the column.
          translations: body.translations ?? null,
        })
        .returning();

      if (!row) {
        return c.json({ error: { code: 'create_failed', message: 'Insert returned no row.' } }, 500);
      }

      // Persist category memberships only when the admin supplied
      // them; a category-less draft is a legitimate state. If this
      // call fails we roll back the template row so the admin doesn't
      // end up with an orphan they can't easily see.
      let ordered: { primary: string; extras: string[]; all: string[] } | null = null;
      if (catFields) {
        try {
          await insertTemplateCategories(c.var.db, row.id, catFields.primary, catFields.extras);
          ordered = {
            primary: catFields.primary,
            extras: catFields.extras,
            all: [catFields.primary, ...catFields.extras],
          };
        } catch (err) {
          await c.var.db.delete(templates).where(eq(templates.id, row.id));
          throw err;
        }
      }

      // The created id isn't in the URL — hand it (and the title) to the
      // audit middleware so the activity feed can attribute the creation.
      c.set('audit', {
        resourceId: row.id,
        metadata: { action: 'create', title: row.title, slug },
      });

      return c.json(
        { data: { ...attachAdminCategoryFields(row, ordered), costBreakdown } },
        201,
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('templates_slug_unique')) {
        return c.json(
          { error: { code: 'slug_taken', message: `Slug "${slug}" already exists.` } },
          409,
        );
      }
      throw err;
    }
  },
);

templatesRoute.patch(
  '/:id',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('param', idParamSchema),
  zValidator('json', updateTemplateSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    // Resolve + validate category fields when the admin sent them.
    // `null` here means "the patch doesn't touch categories"; we
    // leave the existing membership intact.
    const catFields = resolveCategoryFields(body);
    if (catFields) {
      const valid = validateCategorySet({
        primaryCategoryId: catFields.primary,
        extraCategoryIds: catFields.extras,
      });
      if (!valid.ok) {
        return c.json({ error: { code: 'invalid_categories', message: valid.reason } }, 400);
      }
    }

    // ── Video-template cover guard ──────────────────────────────────
    // Video templates depend on `cover_media` for the still poster
    // rendered under the looping clip on mobile. With a NULL cover
    // the catalog DTO emits an empty url and `<Image source="" />`
    // shows a broken glyph (see the "Video Magic" rail screenshots
    // we triaged). Reject any patch that would clear cover_media on
    // a video template — admins must upload a replacement first.
    //
    // We only fetch the existing row when we actually need to check,
    // to avoid an extra DB round-trip on the common patch flow that
    // doesn't touch the cover.
    if (body.coverMedia === null) {
      const existing = await c.var.db.query.templates.findFirst({
        where: eq(templates.id, id),
        columns: { kind: true },
      });
      const nextKind = body.kind ?? existing?.kind;
      // `video_image` templates also lead with a video → same poster rule.
      if (nextKind === 'video' || nextKind === 'video_image') {
        return c.json(
          {
            error: {
              code: 'cover_required_for_video',
              message:
                'Video templates require a cover image. Upload a new cover before clearing the existing one.',
            },
          },
          400,
        );
      }
    }

    // Build a `set` object that only includes fields the admin actually
    // sent. Using spread + conditional avoids overwriting columns with
    // `undefined` (Drizzle would happily NULL them otherwise).
    const set: Partial<Template> = {};
    if (body.title !== undefined) set.title = body.title;
    if (body.slug !== undefined) set.slug = await uniqueSlug(c.var.db, body.slug, id);
    if (body.description !== undefined) set.description = body.description;
    if (body.authorName !== undefined) set.authorName = body.authorName;
    // Category membership lives in `template_categories` and is
    // updated below, AFTER the template row update succeeds.
    if (body.kind !== undefined) set.kind = body.kind;
    if (body.featured !== undefined) set.featured = body.featured;
    if (body.coverMedia !== undefined) set.coverMedia = body.coverMedia;
    if (body.previewVideo !== undefined) set.previewVideo = body.previewVideo;
    if (body.gallery !== undefined) set.gallery = body.gallery;
    if (body.userInputs !== undefined) set.userInputs = body.userInputs;
    if (body.userCanChooseAspectRatio !== undefined) {
      set.userCanChooseAspectRatio = body.userCanChooseAspectRatio;
    }
    if (body.defaultAspectRatio !== undefined) set.defaultAspectRatio = body.defaultAspectRatio;
    // When the stages change we re-derive `generation.mode` and the
    // entire `output` block from them. This keeps the row internally
    // consistent without depending on an Output settings UI that
    // doesn't exist yet. If only `output` was sent (no `generation`),
    // we persist it as-is — the admin's later "Save & Publish"
    // round-trip will re-derive once the stages flow through.
    let costBreakdown: Awaited<ReturnType<typeof computeTemplateCost>> | null = null;
    if (body.generation !== undefined) {
      const sanitized = sanitizeGenerationForPersist(body.generation);
      const derived = deriveGenerationAndOutput(sanitized, body.output);
      set.generation = derived.generation;
      set.output = derived.output;
      // Re-derive cost whenever the pipeline changes. No manual
      // override accepted — `body.costCredits` is ignored on purpose.
      costBreakdown = await computeTemplateCost(c.var.db, derived.generation.stages);
      set.costCredits = costBreakdown.total;
    } else if (body.output !== undefined) {
      set.output = body.output;
    }
    if (body.sortOrder !== undefined) set.sortOrder = body.sortOrder;
    // Only write `translations` when the patch explicitly includes it.
    // Admin's normal save payload omits it entirely (see admin
    // `toServerPayload`), so existing Arabic content is never touched or
    // nulled by a routine English-only edit.
    if (body.translations !== undefined) set.translations = body.translations;

    set.updatedAt = new Date();

    try {
      const [row] = await c.var.db
        .update(templates)
        .set(set)
        .where(eq(templates.id, id))
        .returning();
      if (!row) {
        return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
      }

      // If the admin touched categories, replace the whole membership
      // set atomically (delete-then-insert inside a single CTE).
      if (catFields) {
        await replaceTemplateCategories(c.var.db, id, catFields.primary, catFields.extras);
      }

      const cats = await loadTemplateCategories(c.var.db, id);
      const decorated = attachAdminCategoryFields(row, cats);
      return c.json({ data: costBreakdown ? { ...decorated, costBreakdown } : decorated });
    } catch (err) {
      if (err instanceof Error && err.message.includes('templates_slug_unique')) {
        return c.json(
          { error: { code: 'slug_taken', message: `Slug already exists.` } },
          409,
        );
      }
      throw err;
    }
  },
);

// ─── Archive / Restore / Purge ──────────────────────────────────────
//
// `DELETE /v1/admin/templates/:id` is a SOFT-archive: it flips
// `status` to `archived` and stamps `archived_at`. The row stays in
// the database so every job, library entry, and audit-log entry that
// references it keeps working — users' generations are theirs, and
// hard-deleting the template would either orphan or destroy them.
//
// `jobs.template_id` and `jobs.template_version_id` are both
// `ON DELETE RESTRICT` for exactly that reason; the archive flow
// respects the schema's intent (see `reports.ts` schema header:
// "we never DELETE rows we'd want to FK to — jobs and templates are
// soft-deleted in place").
//
// To permanently remove a template that has truly never been used,
// use `DELETE /v1/admin/templates/:id/purge`. It's gated on a
// "no jobs referencing this template" check and returns
// `409 template_in_use` otherwise, so a bug here can never destroy a
// user-owned generation.
//
// To bring an archived template back, use
// `POST /v1/admin/templates/:id/restore` — it flips status to
// `draft` (NOT directly to `published`; the admin re-publishes
// explicitly so the publish-readiness checks run again).

templatesRoute.delete(
  '/:id',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');

    // Read first so we can return a clean 404 distinct from the
    // already-archived case (idempotent — second archive is a no-op).
    const existing = await c.var.db.query.templates.findFirst({
      where: eq(templates.id, id),
      columns: { id: true, status: true, archivedAt: true },
    });
    if (!existing) {
      return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
    }

    if (existing.status === 'archived') {
      // Idempotent — return the row as-is. We could 204 but the admin
      // UI prefers a body to update its local state.
      const cats = await loadTemplateCategories(c.var.db, id);
      const row = await c.var.db.query.templates.findFirst({ where: eq(templates.id, id) });
      return c.json({
        data: {
          ...attachAdminCategoryFields(row!, cats),
          archived: true,
          alreadyArchived: true,
        },
      });
    }

    const archivedAt = new Date();
    const [row] = await c.var.db
      .update(templates)
      .set({ status: 'archived', archivedAt, updatedAt: archivedAt })
      .where(eq(templates.id, id))
      .returning();
    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
    }

    const cats = await loadTemplateCategories(c.var.db, id);
    return c.json({
      data: { ...attachAdminCategoryFields(row, cats), archived: true },
    });
  },
);

templatesRoute.post(
  '/:id/restore',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');

    // Restore lands in `draft` so the publish-readiness gate runs
    // again before the row reappears in the public catalog. Avoids
    // a "restored straight to published with stale config" footgun.
    const [row] = await c.var.db
      .update(templates)
      .set({ status: 'draft', archivedAt: null, updatedAt: new Date() })
      .where(eq(templates.id, id))
      .returning();
    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
    }
    const cats = await loadTemplateCategories(c.var.db, id);
    return c.json({ data: attachAdminCategoryFields(row, cats) });
  },
);

templatesRoute.delete(
  '/:id/purge',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');

    // Refuse if any job has ever referenced this template — the FK
    // would refuse anyway (RESTRICT), but a clean 409 with an action
    // hint is far friendlier than a generic Postgres error bubbling
    // up. We count both the direct FK (`jobs.template_id`) and the
    // indirect path (`jobs.template_version_id` → `template_versions
    // .template_id`); either is enough to block the purge.
    const [{ jobCount }] = await c.var.db
      .select({ jobCount: sql<number>`count(*)::int` })
      .from(jobs)
      .where(eq(jobs.templateId, id));

    if (jobCount > 0) {
      return c.json(
        {
          error: {
            code: 'template_in_use',
            message:
              'This template has been used to create generations and cannot be permanently deleted. Archive it instead.',
            details: { jobCount },
          },
        },
        409,
      );
    }

    // Safe to hard-delete. `template_versions`, `template_categories`
    // and `saved_templates` all `ON DELETE CASCADE`, so they go away
    // with the parent row in one statement.
    const [row] = await c.var.db
      .delete(templates)
      .where(eq(templates.id, id))
      .returning();
    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
    }
    return c.json({ data: { id: row.id, purged: true } });
  },
);
