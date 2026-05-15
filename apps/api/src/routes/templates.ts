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
import { and, asc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { templateVersions, templates, type Template } from '@clickfy/db';
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
    provider: 'gemini' | 'kling';
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
    if (stage.provider === 'kling') return 'video';
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
 *   - search    — substring match on `title` (case-insensitive)
 *   - status    — draft | published | archived
 *   - kind      — image | video | image_set
 *   - categoryId
 *   - cursor    — opaque cursor returned by the previous page
 *   - limit     — 1..100, default 50
 *
 * Pagination is cursor-based on `(sortOrder, id)` for stable ordering
 * even when an admin reorders mid-pagination.
 *
 * Auth: admin-only because the listing includes draft + archived rows.
 * The mobile-facing equivalent is `/v1/catalog/templates`, which is
 * unauthenticated and only returns published rows.
 */
const listQuerySchema = z.object({
  search: z.string().max(120).optional(),
  status: templateStatusSchema.optional(),
  kind: templateKindSchema.optional(),
  categoryId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

templatesRoute.get(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('query', listQuerySchema),
  async (c) => {
  const q = c.req.valid('query');
  const whereParts: SQL[] = [];

  if (q.search) whereParts.push(ilike(templates.title, `%${q.search}%`));
  if (q.status) whereParts.push(eq(templates.status, q.status));
  if (q.kind) whereParts.push(eq(templates.kind, q.kind));
  // Match the primary OR any extra category — same predicate the
  // public catalog uses, so admin filters mirror what the user sees.
  if (q.categoryId) whereParts.push(templateInCategory(q.categoryId));

  // Cursor format: `<sortOrder>:<id>` (sortOrder is the primary axis,
  // id breaks ties when many rows share a sort order).
  if (q.cursor) {
    const [sortOrderRaw, idCursor] = q.cursor.split(':');
    const sortOrderCursor = Number.parseInt(sortOrderRaw, 10);
    if (Number.isFinite(sortOrderCursor) && idCursor) {
      // We want rows with (sortOrder, id) strictly GREATER than the
      // cursor (ascending sort). Drizzle doesn't ship a tuple
      // comparator helper; the raw SQL fragment below does the right
      // thing and stays parameterised.
      whereParts.push(
        sql`(${templates.sortOrder}, ${templates.id}::text) > (${sortOrderCursor}, ${idCursor})`,
      );
    }
  }

  const rows = await c.var.db
    .select()
    .from(templates)
    .where(whereParts.length > 0 ? and(...whereParts) : undefined)
    .orderBy(asc(templates.sortOrder), asc(templates.id))
    .limit(q.limit + 1);

  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.sortOrder}:${last.id}` : null;

  // Bulk-load category memberships for this page and decorate each
  // row with the legacy `categoryId` (= primary) plus the new
  // `primaryCategoryId` / `extraCategoryIds` / `categoryIds` fields.
  const catsMap = await loadTemplateCategoriesMap(
    c.var.db,
    page.map((r) => r.id),
  );
  const data = page.map((row) =>
    attachAdminCategoryFields(row, catsMap.get(row.id) ?? null),
  );

  return c.json({ data, nextCursor });
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
  withAdmin(),
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
  withAdmin(),
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
  withAdmin(),
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

    // Next version number — read current max, increment. Uniqueness is
    // enforced by the `(template_id, version_number)` unique index, so
    // a concurrent publish on the same template would surface as a
    // constraint error here (uncommon enough in practice).
    const [{ nextVersion }] = await c.var.db
      .select({ nextVersion: sql<number>`coalesce(max(${templateVersions.versionNumber}), 0) + 1` })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, id));

    // Load current category memberships and embed them in the
    // snapshot JSON so a future "restore version N" can rebuild
    // exactly what was published — full-restore semantics per the
    // design discussion.
    const cats = await loadTemplateCategories(c.var.db, id);
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

    return c.json({ data: attachAdminCategoryFields(updated!, cats) });
  },
);

templatesRoute.post(
  '/:id/unpublish',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
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
  withAdmin(),
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
    // is unaffected by anything downstream.
    const srcCats = await loadTemplateCategories(c.var.db, id);
    if (!srcCats) {
      return c.json(
        { error: { code: 'orphaned_template', message: 'Source template has no categories — cannot duplicate.' } },
        409,
      );
    }

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
      })
      .returning();

    if (!clone) {
      return c.json({ error: { code: 'create_failed', message: 'Failed to clone template.' } }, 500);
    }

    await insertTemplateCategories(c.var.db, clone.id, srcCats.primary, srcCats.extras);

    return c.json({ data: attachAdminCategoryFields(clone, srcCats) }, 201);
  },
);

// ─── Write (admin) ──────────────────────────────────────────────────

templatesRoute.post(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('json', createTemplateSchema),
  async (c) => {
    const body = c.req.valid('json');

    // Resolve + validate category fields up-front so an obviously-bad
    // payload (e.g. >3 categories, primary listed as extra) is
    // rejected before we burn a slug + an insert.
    const catFields = resolveCategoryFields(body);
    if (!catFields) {
      return c.json(
        { error: { code: 'category_required', message: 'A primary category is required.' } },
        400,
      );
    }
    const valid = validateCategorySet({
      primaryCategoryId: catFields.primary,
      extraCategoryIds: catFields.extras,
    });
    if (!valid.ok) {
      return c.json({ error: { code: 'invalid_categories', message: valid.reason } }, 400);
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
          coverMedia: body.coverMedia,
          previewVideo: body.previewVideo ?? null,
          gallery: body.gallery,
          userInputs: body.userInputs,
          userCanChooseAspectRatio: body.userCanChooseAspectRatio,
          defaultAspectRatio: body.defaultAspectRatio ?? null,
          generation: derived.generation,
          output: derived.output,
          costCredits: costBreakdown.total,
          sortOrder: body.sortOrder,
        })
        .returning();

      if (!row) {
        return c.json({ error: { code: 'create_failed', message: 'Insert returned no row.' } }, 500);
      }

      // Persist category memberships. If this fails the orphaned
      // template row would be invisible to category-filtered queries;
      // surface a 500 with a clean message so the admin retries.
      try {
        await insertTemplateCategories(c.var.db, row.id, catFields.primary, catFields.extras);
      } catch (err) {
        // Best-effort cleanup — keeps the DB tidy even though the
        // failure is very unlikely (only category-FK violations
        // realistically land here, which we already validated above).
        await c.var.db.delete(templates).where(eq(templates.id, row.id));
        throw err;
      }

      const ordered = {
        primary: catFields.primary,
        extras: catFields.extras,
        all: [catFields.primary, ...catFields.extras],
      };
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
  withAdmin(),
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

templatesRoute.delete(
  '/:id',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const [row] = await c.var.db
      .delete(templates)
      .where(eq(templates.id, id))
      .returning();
    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Template not found.' } }, 404);
    }
    return c.json({ data: { id: row.id, deleted: true } });
  },
);
