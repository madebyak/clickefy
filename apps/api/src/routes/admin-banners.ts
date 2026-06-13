/**
 * Admin home-banners surface.
 *
 *   GET    /v1/admin/banners            — list all (active + scheduled + inactive)
 *   POST   /v1/admin/banners            — create
 *   PATCH  /v1/admin/banners/:id        — update any subset of fields
 *   DELETE /v1/admin/banners/:id        — hard delete
 *   POST   /v1/admin/banners/reorder    — bulk drag-drop reorder
 *
 * All endpoints require `entitlement = 'admin'` via `withAdmin`,
 * which also writes an `admin_audit_log` row for each call so we
 * can answer "who changed the homepage banner on Tuesday at 4pm".
 *
 * Validation rules worth calling out:
 *
 *   - Every banner row holds exactly one media file (`media.length
 *     === 1`). Slider behavior on the home screen comes from creating
 *     multiple banner rows; the mobile pager swipes between them in
 *     `sortOrder`. The legacy `image_slider` kind is preserved in the
 *     DB enum for back-compat but is no longer accepted on writes.
 *
 *   - `cta.kind = 'none'` ↔ `cta.target = null`. Other CTA kinds
 *     require a non-empty `target`, and `external_url` requires a
 *     parseable URL string.
 *
 *   - `endsAt > startsAt` whenever both are set.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { homeBanners } from '@clickfy/db';
import type { HomeBanner, MediaRef } from '@clickfy/types';

import type { AppEnv } from '../types';
import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';

export const adminBannersRoute = new Hono<AppEnv>();

// ─── Schemas ────────────────────────────────────────────────────────

/**
 * Mirror of the `MediaRef` JSON shape from `@clickfy/types`. Kept
 * inline (not imported) so changes to the storage shape have to be
 * conscious — admin payloads validate against the API's exact
 * contract, not whatever the type def happens to say today.
 */
const mediaRefSchema = z.object({
  r2Key: z.string().min(1),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  blurhash: z.string(),
  cdnUrl: z.string().url().optional(),
});

const ctaSchema = z
  .object({
    kind: z.enum(['none', 'template', 'category', 'external_url']),
    target: z.string().nullable().optional(),
    label: z.string().max(40).nullable().optional(),
  })
  .superRefine((cta, ctx) => {
    if (cta.kind === 'none') {
      if (cta.target) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'cta.target must be null when cta.kind is "none".',
          path: ['target'],
        });
      }
      return;
    }
    if (!cta.target || cta.target.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cta.target is required for non-"none" cta.kind.',
        path: ['target'],
      });
      return;
    }
    if (cta.kind === 'external_url') {
      try {
        new URL(cta.target);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'cta.target must be a valid URL when cta.kind is "external_url".',
          path: ['target'],
        });
      }
    } else {
      // 'template' or 'category' — target should look like a UUID.
      // Refuse non-UUID-looking strings so dashboard typos don't
      // produce 404s on every banner tap.
      const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidLike.test(cta.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `cta.target must be a UUID when cta.kind is "${cta.kind}".`,
          path: ['target'],
        });
      }
    }
  });

// Non-English overrides for `title` / `subtitle` / `ctaLabel`, keyed by
// locale. Mirrors `HomeBannerTranslations` in `@clickfy/types`. English
// columns stay canonical; bounds mirror the canonical field limits.
const localeKeySchema = z.enum(['en', 'ar']);
const bannerTranslationsSchema = z.record(
  localeKeySchema,
  z.object({
    title: z.string().max(80).optional(),
    subtitle: z.string().max(160).optional(),
    ctaLabel: z.string().max(32).optional(),
  }),
);

const bannerCreateSchema = z
  .object({
    kind: z.enum(['image', 'video']),
    media: z.array(mediaRefSchema).length(1),
    title: z.string().max(80).nullable().optional(),
    subtitle: z.string().max(160).nullable().optional(),
    cta: ctaSchema.optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    translations: bannerTranslationsSchema.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    // Schedule sanity.
    if (v.startsAt && v.endsAt && new Date(v.endsAt) <= new Date(v.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endsAt must be after startsAt.',
        path: ['endsAt'],
      });
    }
  });

// PATCH allows any subset; we re-validate per-field constraints in
// the handler against the merged row to avoid coupling create/update
// rules.
const bannerUpdateSchema = z
  .object({
    kind: z.enum(['image', 'video']).optional(),
    media: z.array(mediaRefSchema).length(1).optional(),
    title: z.string().max(80).nullable().optional(),
    subtitle: z.string().max(160).nullable().optional(),
    cta: ctaSchema.optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    translations: bannerTranslationsSchema.nullable().optional(),
  })
  .strict();

const reorderSchema = z.object({
  /** Ordered list of banner ids — index in the array becomes new sortOrder. */
  ids: z.array(z.string().uuid()).min(1).max(50),
});

const idParamSchema = z.object({ id: z.string().uuid() });

// ─── Helpers ────────────────────────────────────────────────────────

function rowToDto(row: typeof homeBanners.$inferSelect): HomeBanner {
  return {
    id: row.id,
    kind: row.kind,
    media: (row.media ?? []) as MediaRef[],
    title: row.title,
    subtitle: row.subtitle,
    cta: {
      kind: row.ctaKind,
      target: row.ctaTarget ?? null,
      label: row.ctaLabel ?? null,
    },
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    translations: row.translations ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Routes ─────────────────────────────────────────────────────────

adminBannersRoute.get(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'home' }),
  async (c) => {
    const rows = await c.var.db
      .select()
      .from(homeBanners)
      .orderBy(asc(homeBanners.sortOrder), desc(homeBanners.createdAt));
    return c.json({ data: rows.map(rowToDto) });
  },
);

adminBannersRoute.post(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'home' }),
  zValidator('json', bannerCreateSchema),
  async (c) => {
    const body = c.req.valid('json');
    const cta = body.cta ?? { kind: 'none' as const, target: null, label: null };

    // If sortOrder isn't supplied, append to the end (max + 1) so a
    // freshly-created banner doesn't accidentally jump above existing
    // ones with sortOrder=0. Cheap MAX query — banner table is tiny.
    let sortOrder = body.sortOrder;
    if (sortOrder === undefined) {
      const last = await c.var.db
        .select({ s: homeBanners.sortOrder })
        .from(homeBanners)
        .orderBy(desc(homeBanners.sortOrder))
        .limit(1);
      sortOrder = (last[0]?.s ?? -1) + 1;
    }

    const [created] = await c.var.db
      .insert(homeBanners)
      .values({
        kind: body.kind,
        media: body.media,
        title: body.title ?? null,
        subtitle: body.subtitle ?? null,
        ctaKind: cta.kind,
        ctaTarget: cta.target ?? null,
        ctaLabel: cta.label ?? null,
        sortOrder,
        isActive: body.isActive ?? true,
        translations: body.translations ?? null,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
      })
      .returning();

    if (!created) {
      return c.json(
        { error: { code: 'insert_failed', message: 'Could not create banner.' } },
        500,
      );
    }
    return c.json({ data: rowToDto(created) }, 201);
  },
);

adminBannersRoute.patch(
  '/:id',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'home' }),
  zValidator('param', idParamSchema),
  zValidator('json', bannerUpdateSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const existing = await c.var.db.query.homeBanners.findFirst({
      where: eq(homeBanners.id, id),
    });
    if (!existing) {
      return c.json({ error: { code: 'not_found', message: 'Banner not found.' } }, 404);
    }

    // Each banner row holds exactly one media file. (Slider behavior
    // on mobile is achieved by creating multiple banner rows.) We
    // re-check against the post-merge values so a PATCH that only
    // touches kind without resending media still validates.
    const nextMedia = (body.media ?? (existing.media as MediaRef[])) as MediaRef[];
    if (nextMedia.length !== 1) {
      return c.json(
        {
          error: {
            code: 'invalid_media_count',
            message: 'A banner requires exactly one media entry.',
          },
        },
        400,
      );
    }
    const nextStarts = body.startsAt !== undefined
      ? body.startsAt ? new Date(body.startsAt) : null
      : existing.startsAt;
    const nextEnds = body.endsAt !== undefined
      ? body.endsAt ? new Date(body.endsAt) : null
      : existing.endsAt;
    if (nextStarts && nextEnds && nextEnds <= nextStarts) {
      return c.json(
        { error: { code: 'invalid_schedule', message: 'endsAt must be after startsAt.' } },
        400,
      );
    }

    // Build the partial update — only set fields the caller actually
    // sent. `cta` is a sub-object; if present, all three columns are
    // overwritten in lockstep so we never observe a half-applied CTA.
    const patch: Partial<typeof homeBanners.$inferInsert> = { updatedAt: new Date() };
    if (body.kind !== undefined) patch.kind = body.kind;
    if (body.media !== undefined) patch.media = body.media;
    if (body.title !== undefined) patch.title = body.title;
    if (body.subtitle !== undefined) patch.subtitle = body.subtitle;
    if (body.cta !== undefined) {
      patch.ctaKind = body.cta.kind;
      patch.ctaTarget = body.cta.target ?? null;
      patch.ctaLabel = body.cta.label ?? null;
    }
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (body.translations !== undefined) patch.translations = body.translations;
    if (body.startsAt !== undefined)
      patch.startsAt = body.startsAt ? new Date(body.startsAt) : null;
    if (body.endsAt !== undefined)
      patch.endsAt = body.endsAt ? new Date(body.endsAt) : null;

    const [updated] = await c.var.db
      .update(homeBanners)
      .set(patch)
      .where(eq(homeBanners.id, id))
      .returning();
    if (!updated) {
      return c.json(
        { error: { code: 'update_failed', message: 'Could not update banner.' } },
        500,
      );
    }
    return c.json({ data: rowToDto(updated) });
  },
);

adminBannersRoute.delete(
  '/:id',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'home' }),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await c.var.db
      .delete(homeBanners)
      .where(eq(homeBanners.id, id))
      .returning();
    if (result.length === 0) {
      return c.json({ error: { code: 'not_found', message: 'Banner not found.' } }, 404);
    }
    return c.body(null, 204);
  },
);

adminBannersRoute.post(
  '/reorder',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'home' }),
  zValidator('json', reorderSchema),
  async (c) => {
    const { ids } = c.req.valid('json');

    // Verify every id exists before we touch any row — partial
    // reorders are confusing, and the failure mode of "you reordered
    // 5 of 6 banners" is worse than just rejecting the whole call.
    const existing = await c.var.db
      .select({ id: homeBanners.id })
      .from(homeBanners)
      .where(inArray(homeBanners.id, ids));
    if (existing.length !== ids.length) {
      return c.json(
        {
          error: {
            code: 'unknown_ids',
            message: 'One or more banner ids do not exist.',
          },
        },
        400,
      );
    }

    // Apply the new ordering. A small banner table (we expect <50
    // rows lifetime) makes a per-row UPDATE acceptable; if this ever
    // grows we can switch to a single CTE-based upsert.
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      await c.var.db
        .update(homeBanners)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(homeBanners.id, id));
    }

    const rows = await c.var.db
      .select()
      .from(homeBanners)
      .where(inArray(homeBanners.id, ids))
      .orderBy(asc(homeBanners.sortOrder));
    return c.json({ data: rows.map(rowToDto) });
  },
);
