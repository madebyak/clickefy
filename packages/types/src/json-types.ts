/**
 * Type shapes for our JSONB columns and structured payloads.
 *
 * Postgres JSONB is great for "structured but flexible" data — e.g. the
 * generation recipe inside a template (which varies by provider) or the
 * job result (image[] for image templates, video[] for video templates,
 * both for hybrid). These TS interfaces are pure compile-time validation:
 * they don't constrain what Postgres physically accepts. Runtime
 * validation lives in `packages/sdk` (zod) at the API boundary.
 *
 * Why these live in `@clickfy/types`, not `@clickfy/db`:
 *   - They're pure interfaces with no Drizzle / Postgres dependency.
 *   - The admin and mobile apps need them too. Hosting them here lets
 *     `@clickfy/db` import them (one-way: db → types), keeping the
 *     types package free of any runtime infrastructure.
 */

// ── Media references ────────────────────────────────────────────────

/**
 * Reference to an image stored in our storage layer.
 *
 * `r2Key` is the canonical pointer (object key in R2). When the image
 * is served via Cloudflare Images, `cdnUrl` carries the full delivery
 * URL with transformations baked in (e.g. `…?width=600&format=auto`).
 */
export interface MediaRef {
  /** Object key under our R2 bucket. */
  r2Key: string;
  width: number;
  height: number;
  /** Compact placeholder string for `expo-image`. */
  blurhash: string;
  /** Optional CDN URL override (Stream uses a `streamId` instead, see below). */
  cdnUrl?: string;
}

/** A video stored in Cloudflare Stream (HLS-delivered). */
export interface StreamRef {
  /** Stream's UID for this video. */
  streamId: string;
  durationSec: number;
  /** Poster frame stored in R2 (for thumbs / first-frame on mobile). */
  posterR2Key: string;
}

// ── User input schema (per template) ────────────────────────────────

/**
 * Every discriminator value the dynamic-input renderer knows about.
 *
 * V1 mobile renders: text, textarea, image, image_multi, select.
 * The remaining variants (video, toggle, color) are present in the type
 * so admins can save templates that use them — the mobile app will fall
 * back to a "coming soon" stub until the corresponding control ships.
 */
export type TemplateInputType =
  | 'text'
  | 'textarea'
  | 'image'
  | 'image_multi'
  | 'video'
  | 'select'
  | 'toggle'
  | 'color';

/** Fields every input variant shares — identity, ordering, copy. */
export interface TemplateInputBase {
  id: string;
  fieldKey: string;
  label: string;
  helperText?: string;
  required: boolean;
  order: number;
}

export interface TemplateInputText extends TemplateInputBase {
  type: 'text';
  placeholder?: string;
  /** Hard cap on character count. */
  maxLength?: number;
}

export interface TemplateInputTextarea extends TemplateInputBase {
  type: 'textarea';
  placeholder?: string;
  maxLength?: number;
  /** Suggested minimum visible lines on mobile (defaults to 3). */
  minLines?: number;
}

export interface TemplateInputImage extends TemplateInputBase {
  type: 'image';
  /** Mime types the picker filters by. */
  acceptedFormats?: string[];
  /** Max upload size in megabytes. */
  maxSizeMB?: number;
  /** Smallest dimensions the picker will accept. */
  minResolution?: { width: number; height: number };
  /** Forces a particular aspect for the crop step (e.g. '4:5'). */
  aspectRatio?: string;
}

export interface TemplateInputImageMulti extends TemplateInputBase {
  type: 'image_multi';
  /** Inclusive lower bound on number of images. */
  minCount: number;
  /** Inclusive upper bound. */
  maxCount: number;
  acceptedFormats?: string[];
  maxSizeMB?: number;
  aspectRatio?: string;
}

export interface TemplateInputVideo extends TemplateInputBase {
  type: 'video';
  acceptedFormats?: string[];
  maxSizeMB?: number;
  /** Max duration in seconds. */
  maxDurationSec?: number;
}

/** Option in a `select` field — value flows to prompts; thumb is UX only. */
export interface TemplateInputSelectOption {
  value: string;
  label: string;
  thumbUrl?: string;
}

export interface TemplateInputSelect extends TemplateInputBase {
  type: 'select';
  options: TemplateInputSelectOption[];
  /** When true, mobile renders a chip group; otherwise a dropdown. */
  asChips?: boolean;
}

export interface TemplateInputToggle extends TemplateInputBase {
  type: 'toggle';
  /** Default state for the switch. */
  defaultOn?: boolean;
}

export interface TemplateInputColor extends TemplateInputBase {
  type: 'color';
  /** Suggested swatches the user can tap instead of opening a picker. */
  presets?: string[];
}

/**
 * Discriminated union of every input field type. The `type` literal
 * narrows everywhere — admin form editor, mobile renderer, and the
 * runtime variable resolver all benefit from exhaustive checks.
 */
export type TemplateInputField =
  | TemplateInputText
  | TemplateInputTextarea
  | TemplateInputImage
  | TemplateInputImageMulti
  | TemplateInputVideo
  | TemplateInputSelect
  | TemplateInputToggle
  | TemplateInputColor;

// ── Generation recipe (admin-only, never sent to mobile) ────────────

/**
 * Provider families the generation pipeline can target. Distinct from
 * `model`: a single provider exposes several models (Gemini 3 Pro,
 * Gemini 2.5 Flash Image, Imagen 4, etc.). The provider tells the
 * worker which SDK / endpoint to use; the model decides the exact call
 * shape inside that SDK. The list is intentionally narrow — we add a
 * value here only when a provider adapter actually exists.
 */
export type Provider = 'gemini' | 'kling';

/**
 * Role tags admins attach to reference images so the prompt-compiler
 * knows what each reference is "for" (style transfer vs. composition
 * cue vs. lighting hint, etc.). The list is intentionally finite and
 * matches what the admin form exposes. The role doubles as the
 * preamble text we emit to Gemini ("[STYLE REFERENCE …]:") so the
 * model can distinguish references from subject images.
 */
export type ReferenceImageRole =
  | 'style'
  | 'composition'
  | 'lighting'
  | 'scene'
  | 'example';

/**
 * Reference image attached to a generation stage.
 *
 * `key` is an admin-chosen, slug-style identifier (e.g. `studio_light`)
 * that the prompt uses to address this reference via `{{ref:<key>}}`.
 * It must be unique within a stage. The prompt-compiler maps each
 * `{{ref:<key>}}` token to the matching reference and emits the
 * provider-specific addressing (ordinal text part for Gemini,
 * `<<<image_N>>>` for Kling Omni).
 *
 * `r2Key` is the persisted pointer in Cloudflare R2. The admin form
 * keeps a transient `base64` working copy until the upload completes;
 * the API drops the working fields on save. Once published, only
 * `r2Key` is authoritative.
 */
export interface GenerationReference {
  id: string;
  /** Stable admin-chosen identifier referenced from the prompt. */
  key: string;
  role: ReferenceImageRole;
  /** Persisted R2 object key. */
  r2Key?: string;

  /** @deprecated Admin working state before the R2 upload completes. */
  base64?: string;
  /** @deprecated Admin working state before the R2 upload completes. */
  mimeType?: string;
  /** @deprecated Admin working state before the R2 upload completes. */
  fileName?: string;
  /** @deprecated Free-text caption shown in the admin form only. */
  label?: string;
}

/**
 * One step in the generation pipeline.
 *
 * The `prompt` is authored in our provider-agnostic syntax:
 *   - `{{input:<fieldKey>}}` → a user input value (text or image)
 *   - `{{ref:<key>}}`        → an admin-uploaded reference image
 *   - `{{stage_N_output}}`   → the binary output of stage N (1-indexed)
 *   - `{{previous}}`         → alias for the immediately-previous stage
 *
 * The prompt-compiler (in `@clickfy/providers`) interprets these and
 * produces a provider-shaped request. `config` is intentionally
 * `Record<string, unknown>` because the schema differs per model — the
 * capabilities registry validates the per-model subset.
 */
export interface GenerationStage {
  id: string;
  order: number;
  provider: Provider;
  model: string;
  prompt: string;
  references: GenerationReference[];
  config: Record<string, unknown>;
  retry: {
    enabled: boolean;
    maxAttempts: number;
    fallbackModel?: string;
  };
}

export interface TemplateGeneration {
  mode: 'image' | 'video' | 'image_then_video';
  stages: GenerationStage[];
}

// ── Output settings ─────────────────────────────────────────────────

export interface TemplateOutput {
  type: 'image' | 'video' | 'both';
  count: number;
  format: string; // e.g. 'png' | 'jpg' | 'mp4'
  allowRegeneration: boolean;
  watermark?: 'always' | 'free_only' | 'never';
}

// ── Template analytics rollup ───────────────────────────────────────

export interface TemplateStats {
  views: number;
  runs: number;
  successRate: number; // 0..1
  avgRuntimeMs: number;
}

// ── Job state ───────────────────────────────────────────────────────

export type JobInputValue =
  | { kind: 'image' | 'video'; r2Key: string; mimeType: string; sizeBytes: number }
  | { kind: 'text'; value: string };

export interface JobProgress {
  stage: number;
  totalStages: number;
  message: string;
}

export interface JobResult {
  images: MediaRef[];
  videos: StreamRef[];
  durationMs: number;
  costCredits: number;
}

export interface JobError {
  code: string;
  message: string;
  stage: number;
  retryCount: number;
}

// `ProviderCapabilities` used to live here. The richer per-model
// capability shape (sizing modes, named-ref syntax, etc.) lives in
// `@clickfy/providers` so the worker, admin form, and prompt-compiler
// stay aligned. Nothing should import a `ProviderCapabilities` symbol
// from this package any more.
