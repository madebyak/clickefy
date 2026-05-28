/**
 * `home_banners` — the dynamic banner strip rendered above the
 * "Trending Now" rail on the mobile home screen.
 *
 * Each row is one banner slot. Admin curates the list; mobile fetches
 * everything currently active (within optional schedule window) and
 * renders them in `sort_order`. The first one is the one users see
 * unless they swipe (image_slider) or scroll on (single banner).
 *
 * Why a dedicated table (not reusing `templates` with a "banner" kind):
 *
 *   - Banners aren't generations. They have no input form, no credit
 *     cost, no provider pipeline. Conflating them would mean every
 *     template query has to filter them out and every banner query
 *     has to ignore template-only fields.
 *
 *   - Banners are landscape (16:9), templates are portrait. Different
 *     media constraints. Keeping the storage separate makes both
 *     surfaces easier to reason about.
 *
 *   - Banners get scheduled (start/end), templates don't.
 *
 * Media:
 *   - For `image`        — `media` is a 1-element array
 *   - For `image_slider` — `media` is an N-element array; render order
 *                          matches array order
 *   - For `video`        — `media` is a 1-element array; the consumer
 *                          plays muted, looping, auto-playing
 *
 * Storage of media itself reuses the same R2 buckets and `MediaRef`
 * shape that templates use, so the upload pipeline (admin → R2 →
 * MediaRef JSON) is unchanged.
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

import type { MediaRef } from './json-types';
import { homeBannerCtaKindEnum, homeBannerKindEnum } from './enums';

export const homeBanners = pgTable(
  'home_banners',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    kind: homeBannerKindEnum('kind').notNull(),

    /**
     * Ordered list of media references. One element for `image` /
     * `video`; one-or-more for `image_slider`. Stored as JSONB so we
     * can attach blurhashes, alt text, and per-asset metadata without
     * a separate `home_banner_media` table.
     */
    media: jsonb('media').$type<MediaRef[]>().notNull().default(sql`'[]'::jsonb`),

    /** Optional overlay headline (e.g. "Black Friday: 50% off"). */
    title: text('title'),
    /** Optional overlay subheading. */
    subtitle: text('subtitle'),

    /** Optional CTA label e.g. "Try it" — only rendered when present. */
    ctaLabel: text('cta_label'),
    ctaKind: homeBannerCtaKindEnum('cta_kind').notNull().default('none'),
    /**
     * Polymorphic CTA target — interpretation depends on `cta_kind`:
     *   - 'template'       → templates.id (uuid)
     *   - 'category'       → categories.id (uuid)
     *   - 'external_url'   → absolute URL string
     *   - 'none'           → must be NULL
     *
     * Stored as plain text rather than two FK columns to keep the
     * shape simple; the API layer is the source of validation.
     */
    ctaTarget: text('cta_target'),

    /** Manual ordering; lower is shown first. Defaulted server-side. */
    sortOrder: integer('sort_order').default(0).notNull(),

    /**
     * Master switch. The public list endpoint also enforces the
     * schedule window below; `is_active = false` short-circuits even
     * when the window says "live now" — useful for taking a banner
     * down without losing its scheduled timestamps.
     */
    isActive: boolean('is_active').default(true).notNull(),

    /**
     * Schedule window. Both NULL = "always-on" (subject to is_active).
     * `starts_at NOT NULL` = "live from this moment". `ends_at NOT NULL`
     * = "live until this moment".
     */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    // Composite index used by the public list query
    // (WHERE is_active = true ... ORDER BY sort_order, created_at).
    // `is_active` first so the filter is selective; `sort_order` next
    // matches the ORDER BY for index-only ordering.
    index('home_banners_active_sort_idx').on(t.isActive, t.sortOrder),
  ],
);

export type HomeBanner = typeof homeBanners.$inferSelect;
export type NewHomeBanner = typeof homeBanners.$inferInsert;
