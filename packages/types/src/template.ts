/**
 * Canonical Template type — single source of truth.
 *
 * Mirrors the Postgres row shape defined in
 * `packages/db/src/schema/templates.ts`. Two views derive from it:
 *
 *   - `Template`        — full row, used by admin (CRUD forms, store)
 *   - `MobileTemplate`  — projection sent to the mobile app; strips
 *                          `generation` + `output` (admin-only) and
 *                          flattens media refs to delivery URLs
 *
 * Dates arrive as ISO strings over the wire and are kept as strings
 * here. The admin layer parses them with `new Date(...)` only when
 * formatting for display.
 */

import type {
  MediaRef,
  ReferenceImageRole,
  TemplateGeneration,
  TemplateInputField,
  TemplateOutput,
  TemplateStats,
} from './json-types';

// ─── Enums ──────────────────────────────────────────────────────────

/** User-facing output shape — what the user gets back. */
export type TemplateKind = 'image' | 'video' | 'image_set';

/** Pipeline shape — how the AI gets there (admin-only concern). */
export type GenerationMode = 'image' | 'video' | 'image_then_video';

export type TemplateStatus = 'draft' | 'published' | 'archived';

// ─── Canonical row ──────────────────────────────────────────────────

export interface Template {
  id: string;
  title: string;
  slug: string;
  description: string;
  authorName: string;
  /**
   * Primary category id — the "this is fundamentally an X template"
   * choice. The full membership set lives in `categoryIds` (primary
   * first, then extras). Empty string for drafts that haven't picked
   * a category yet; the publish flow enforces presence.
   */
  primaryCategoryId: string;
  /** Up to 2 additional categories this template also appears under. */
  extraCategoryIds: string[];
  /** Convenience: `[primaryCategoryId, ...extraCategoryIds]`. Empty for
   *  category-less drafts. */
  categoryIds: string[];
  /** @deprecated Use `primaryCategoryId`. Kept for transition. */
  categoryId: string;
  kind: TemplateKind;
  status: TemplateStatus;
  featured: boolean;

  /**
   * Cover image / video poster. Nullable while the template is a
   * draft — the publish flow enforces a non-null cover before the
   * mobile catalog ever surfaces the row, so `MobileTemplate` (the
   * projected wire shape) can keep treating it as required.
   */
  coverMedia: MediaRef | null;
  /**
   * Optional cover preview clip — short, autoplay-looped, muted on
   * mobile. Hosted in R2 alongside images; the cover image (above)
   * doubles as the poster frame on mobile. `null` when the template
   * has no video preview.
   *
   * Historically typed `StreamRef` for Cloudflare Stream — we never
   * wired Stream and migrated to R2-direct so admins can upload an
   * MP4 like any other asset. JSONB column shape is the only thing
   * Postgres cares about, so the migration is type-only.
   */
  previewVideo: MediaRef | null;
  gallery: MediaRef[];

  userInputs: TemplateInputField[];
  userCanChooseAspectRatio: boolean;
  defaultAspectRatio: string | null;

  /** Admin-only — present on admin GETs, stripped from mobile responses. */
  generation: TemplateGeneration;
  /** Admin-only. */
  output: TemplateOutput;

  costCredits: number;
  sortOrder: number;
  stats: TemplateStats;

  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  lastTestedAt: string | null;
}

// Legacy alias — older admin code imports `TemplateInput`. New code
// should use `TemplateInputField`.
export type TemplateInput = TemplateInputField;

/**
 * @deprecated Admin-form local working type. Hold-over from the
 * pre-R2 base64 flow. Phase 4 replaces this with a proper upload
 * pipeline that stores `GenerationReference` (r2Key) instead.
 */
export type InputFieldType = 'image' | 'video' | 'text';

/**
 * @deprecated Admin-form local working type for in-browser reference
 * uploads (base64 in-memory). Phase 4 uploads to R2 and stores the
 * canonical `GenerationReference` (r2Key) instead.
 */
export interface ReferenceImage {
  id: string;
  label: string;
  role: ReferenceImageRole;
  base64: string;
  mimeType: string;
  fileName?: string;
}

// ─── Mobile projection ──────────────────────────────────────────────

/**
 * What the mobile app actually receives. Differences from `Template`:
 *
 *   - `generation`, `output` are stripped (admin-only secrets)
 *   - `coverMedia` is flattened to a delivery URL + dimensions + blurhash
 *   - `previewVideo` becomes an HLS playback URL (or `null`)
 *   - `gallery` becomes an array of delivery URLs with metadata
 *
 * This is the canonical shape the SDK consumes. The API
 * (`templateToMobileDTO`) is the single place this projection happens.
 */
/**
 * Compact description of what a template returns to the user. Mobile
 * renders this as the "What you'll get" preview row — one entry per
 * media class. Safe to surface (no prompts / providers leak), and
 * future-proof for pipelines that emit a mix of images and a video.
 */
export interface MobileTemplateOutputSummary {
  kind: 'image' | 'video';
  count: number;
}

export interface MobileTemplate {
  id: string;
  title: string;
  slug: string;
  description: string;
  /**
   * Primary category id. Legacy single-category field kept on the
   * wire so existing builds keep working — equal to `categoryIds[0]`.
   * New code should prefer `categoryIds`.
   * @deprecated Use `categoryIds[0]`.
   */
  categoryId: string;
  /**
   * Full ordered list of category memberships, primary first then
   * extras by display order. 1..3 entries.
   */
  categoryIds: string[];
  kind: TemplateKind;
  featured: boolean;

  coverImage: MobileImageRef;
  previewVideo: MobileVideoRef | null;
  gallery: MobileImageRef[];

  userInputs: TemplateInputField[];
  userCanChooseAspectRatio: boolean;
  defaultAspectRatio: string | null;

  /**
   * What the user receives back after generation. One entry per media
   * class (image / video). Derived from the admin's `output.type` +
   * `output.count`; an `image_then_video` pipeline that emits both
   * surfaces as `[{ image, 1 }, { video, 1 }]`.
   */
  outputs: MobileTemplateOutputSummary[];

  costCredits: number;
  /**
   * 0..1 — derived from `stats.successRate`. Kept on the wire because
   * we may surface it later (admin tools / debug UI); the mobile UX
   * currently hides any quantitative trust signal.
   */
  successRate: number;
}

/** Mobile-ready image reference — what `<Image source={...}>` consumes. */
export interface MobileImageRef {
  /** Fully-resolved delivery URL (CF Images with format=auto, etc.). */
  url: string;
  width: number;
  height: number;
  blurhash: string;
}

/**
 * Mobile-ready video reference.
 *
 * `hlsUrl` is a misnomer — historically we planned to deliver via
 * Cloudflare Stream (HLS) and the SDK flattens this field into the
 * mobile-facing `previewVideo: string`. The current implementation
 * delivers a progressive MP4/MOV from R2 via the Worker, and `expo-video`
 * plays both URL shapes uniformly. Treat this as "the video URL"; the
 * name is preserved to avoid an SDK-wide rename until the cleanup pass.
 */
export interface MobileVideoRef {
  /** Video URL — HLS manifest or direct MP4. `expo-video` plays both. */
  hlsUrl: string;
  /** Poster image URL (first-frame, or the cover image as a fallback). */
  posterUrl: string;
  /** Duration in seconds. 0 when unknown (admin didn't supply it). */
  durationSec: number;
}

// ─── Form data (admin) ──────────────────────────────────────────────

/**
 * Fields submitted by the admin's New / Edit Template form. Most fields
 * are direct slices of `Template`; only the diff is documented here.
 * Slug + sortOrder are optional — server derives them when omitted.
 */
export interface TemplateFormData {
  title: string;
  slug?: string;
  description: string;
  /**
   * Primary category. Optional on the form (drafts can be saved
   * without one), but enforced by the publish handler before the
   * template can flip from `draft` to `published`.
   */
  primaryCategoryId?: string;
  /** 0..2 extra categories the template should also surface in. */
  extraCategoryIds?: string[];
  /** @deprecated Use `primaryCategoryId`. Kept for older admin code. */
  categoryId?: string;
  kind: TemplateKind;
  featured?: boolean;

  /** Optional on the form — a draft can be saved with no cover yet. */
  coverMedia?: MediaRef | null;
  previewVideo?: MediaRef | null;
  gallery?: MediaRef[];

  userInputs?: TemplateInputField[];
  userCanChooseAspectRatio?: boolean;
  defaultAspectRatio?: string | null;

  generation: TemplateGeneration;
  output: TemplateOutput;

  costCredits?: number;
  sortOrder?: number;
}
