/**
 * Home banner types — shared shapes consumed by the API, the SDK,
 * the mobile app, and the admin dashboard.
 *
 * Two flavours:
 *
 *   - `MobileHomeBanner`  — DTO returned by the public catalog
 *                           endpoint. Discriminated union on `kind`
 *                           with the resolved media shape per kind,
 *                           so `<HomeBanner />` consumers narrow once
 *                           and render directly.
 *
 *   - `HomeBanner`        — full row, returned by admin endpoints.
 *                           Includes scheduling + lifecycle fields and
 *                           keeps the raw `MediaRef[]` so the dashboard
 *                           can edit the underlying R2 keys.
 */

import type { MediaRef } from './json-types';
import type { HomeBannerTranslations } from './localization';
import type { MobileImageRef, MobileVideoRef } from './template';

export type HomeBannerKind = 'image' | 'image_slider' | 'video';

export type HomeBannerCtaKind = 'none' | 'template' | 'category' | 'external_url';

export interface HomeBannerCta {
  kind: HomeBannerCtaKind;
  /**
   * Polymorphic target — interpretation depends on `kind`:
   *   - 'template'     → template id (uuid)
   *   - 'category'     → category id (uuid)
   *   - 'external_url' → fully-qualified URL
   *   - 'none'         → null
   */
  target: string | null;
  /** Optional button label rendered over the banner. */
  label: string | null;
}

interface MobileHomeBannerBase {
  id: string;
  title: string | null;
  subtitle: string | null;
  cta: HomeBannerCta;
}

/**
 * Mobile-facing banner DTO. Discriminated by `kind`. The schedule
 * filter has already been applied server-side; if a banner appears
 * in the response, it is currently live.
 */
export type MobileHomeBanner =
  | (MobileHomeBannerBase & {
      kind: 'image';
      image: MobileImageRef;
    })
  | (MobileHomeBannerBase & {
      kind: 'image_slider';
      /** 1..N entries; render order = array order. */
      images: MobileImageRef[];
    })
  | (MobileHomeBannerBase & {
      kind: 'video';
      video: MobileVideoRef;
    });

/**
 * Admin-facing banner DTO. Keeps the raw `MediaRef[]` so the
 * dashboard can edit R2 keys directly, plus all the lifecycle
 * fields the operator needs to manage drafts and schedules.
 */
export interface HomeBanner {
  id: string;
  kind: HomeBannerKind;
  /** Raw stored MediaRefs, in render order. */
  media: MediaRef[];
  title: string | null;
  subtitle: string | null;
  cta: HomeBannerCta;
  sortOrder: number;
  isActive: boolean;
  /** ISO 8601 timestamps; null = "always" on the open end. */
  startsAt: string | null;
  endsAt: string | null;
  /**
   * Non-English overrides for `title`/`subtitle`/`ctaLabel`, keyed by
   * locale; the English columns are the fallback. Optional/`null` when
   * no translations exist.
   */
  translations?: HomeBannerTranslations | null;
  createdAt: string;
  updatedAt: string;
}
