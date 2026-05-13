/**
 * `templates` — the working draft of every generation recipe.
 *
 * Two important rules baked into the schema:
 *
 *   1. `generation` is admin-only — server-side projections strip it
 *      before sending a template to the mobile client. The DB doesn't
 *      enforce that; the API does (`templateToMobileDTO()`).
 *
 *   2. Every publish action snapshots the row into `template_versions`.
 *      A job records the EXACT version it ran against, so prompt edits
 *      never retroactively change a user's already-delivered result.
 *
 * Media model:
 *   - `coverMedia`   → poster used in homepage rails, category lists,
 *                      and as the still frame when `previewVideo` is set
 *   - `previewVideo` → optional 4–8s clip, autoplay-looped on cards/hero
 *   - `gallery`      → array of images shown in the detail-page carousel
 *
 * All media references are R2-backed (`MediaRef.r2Key`). The Worker
 * serves them through `/v1/uploads/<key>` with `Accept-Ranges` so
 * iOS AVPlayer can stream the preview clip inline. Cloudflare Images
 * / Stream were considered earlier but we ship MP4-direct because
 * the file sizes are small (25 MB ceiling) and the indirection wasn't
 * earning its keep.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { templateKindEnum, templateStatusEnum } from './enums';
import type {
  MediaRef,
  TemplateGeneration,
  TemplateInputField,
  TemplateOutput,
  TemplateStats,
} from './json-types';
import { categories } from './categories';

// Inlined as a raw SQL literal — drizzle-kit's diff engine doesn't accept
// parameterized defaults, so we cannot interpolate JSON.stringify() here.
const DEFAULT_STATS_LITERAL =
  `'{"views":0,"runs":0,"successRate":0,"avgRuntimeMs":0}'::jsonb`;

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),

    /** Single description — rendered with line-clamp in tight spaces. */
    description: text('description').default('').notNull(),

    /** Display credit on the detail page. Defaults to in-house studio. */
    authorName: text('author_name').default('Clickfy Studio').notNull(),

    categoryId: uuid('category_id')
      .references(() => categories.id, { onDelete: 'restrict' })
      .notNull(),

    /** User-facing output shape (image / video / image_set). The
     *  pipeline shape (e.g. "image then animate") lives in
     *  `generation.mode` so list filters can index on `kind` alone. */
    kind: templateKindEnum('kind').notNull(),
    status: templateStatusEnum('status').default('draft').notNull(),
    featured: boolean('featured').default(false).notNull(),

    /** Poster image — shown on rails, used as the video poster when
     *  `previewVideo` is set. Hard-aimed at 4:5 portrait for grid
     *  density. */
    coverMedia: jsonb('cover_media').$type<MediaRef>().notNull(),

    /** Optional short autoplay clip (4–8s, muted, looped). When set,
     *  cards play it over the cover poster. Stored as a `MediaRef`
     *  (R2-backed); the column was originally typed `StreamRef` for
     *  Cloudflare Stream but we ship MP4-direct from R2 and Stream
     *  was never wired. JSONB doesn't enforce shape, so no SQL
     *  migration is needed — the type swap is compile-time only. */
    previewVideo: jsonb('preview_video').$type<MediaRef | null>(),

    /** Detail-page carousel. Empty array when the template is a single
     *  cover-only template. */
    gallery: jsonb('gallery')
      .$type<MediaRef[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),

    /** Dynamic form schema the mobile app renders. */
    userInputs: jsonb('user_inputs')
      .$type<TemplateInputField[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    userCanChooseAspectRatio: boolean('user_can_choose_aspect_ratio').default(false).notNull(),
    defaultAspectRatio: text('default_aspect_ratio'),

    /** ADMIN-ONLY — never include in mobile responses. */
    generation: jsonb('generation').$type<TemplateGeneration>().notNull(),
    output: jsonb('output').$type<TemplateOutput>().notNull(),

    costCredits: integer('cost_credits').default(1).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),

    stats: jsonb('stats')
      .$type<TemplateStats>()
      .default(sql.raw(DEFAULT_STATS_LITERAL))
      .notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  },
  (t) => [
    index('templates_status_sort_idx').on(t.status, t.sortOrder),
    index('templates_category_status_idx').on(t.categoryId, t.status),
    index('templates_featured_status_idx').on(t.featured, t.status),
    index('templates_kind_status_idx').on(t.kind, t.status),
  ],
);

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
