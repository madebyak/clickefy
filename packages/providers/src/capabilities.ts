/**
 * `MODEL_CAPABILITIES` — source of truth for what each AI model supports.
 *
 * The admin form reads from this registry to render the right config
 * controls (aspect-ratio dropdown vs. pixel dimensions; durations for
 * video models; how many references the model accepts). The
 * prompt-compiler reads from it to validate stage configs and to pick
 * the right image-addressing strategy (`ordinal` text-part labels for
 * Gemini, `<<<image_N>>>` for Kling Omni, etc.).
 *
 * Adding a new model is a one-file change:
 *   1. Add an entry below.
 *   2. Add a runtime adapter under `src/adapters/` (when wired in
 *      Phase 6) that maps `CompiledRequest` → the provider HTTP call.
 *
 * Removing a model: prefer setting `status: 'deprecated'` rather than
 * deleting the row so older `template_versions` snapshots still
 * resolve.
 */

import type { Provider } from '@clickfy/types';

/** What the model produces. Drives which arm of `CompiledRequest` is built. */
export type ModelKind = 'image' | 'video';

/** How the model addresses dimensions in its API call. */
export type SizingMode =
  /** `aspectRatio` string + optional `imageSize` enum (Gemini / Imagen / Kling). */
  | { mode: 'aspect'; values: readonly string[]; resolutions?: readonly string[] }
  /** Pixel-based `WIDTHxHEIGHT` + optional preset list (GPT Image 2). */
  | {
      mode: 'pixels';
      presets: readonly string[];
      /** Constraint: every edge divisible by this multiple. */
      divisibleBy: number;
      maxEdge: number;
      minPixels: number;
      maxPixels: number;
    };

/**
 * How the model expects references to be addressed from the prompt.
 *
 *  - `ordinal`   → "the first image / the second image" — Gemini-style.
 *                  We emit a text part before each image with the role
 *                  preamble; the prompt can also embed `{{ref:<key>}}`
 *                  tokens which we substitute with "the Nth image"
 *                  textually for clarity.
 *  - `angle`     → `<<<image_N>>>` literal embedded in the prompt
 *                  string itself — Kling Omni.
 *  - `none`      → model does not accept reference images (Imagen).
 */
export type RefAddressingStyle = 'ordinal' | 'angle' | 'none';

export type ModelStatus = 'active' | 'preview' | 'deprecated';

/**
 * Per-model capability declaration. The shape is intentionally narrow:
 * everything here drives concrete decisions in the compiler or the
 * admin UI. Anything that's "nice to know" but not actionable goes in
 * `notes` instead of growing the schema.
 */
export interface ModelCapabilities {
  provider: Provider;
  modelKey: string;
  displayName: string;
  status: ModelStatus;
  kind: ModelKind;

  sizing: SizingMode;

  /** Number of outputs the model can produce per call. */
  outputs: { min: number; max: number; default: number };

  /** Video-only. Seconds. */
  duration?: { values: readonly number[]; default: number };

  /** Quality preset (GPT Image 2). */
  quality?: { values: readonly string[]; default: string };

  /** Optional negative-prompt support (Kling). */
  negativePrompt?: boolean;

  /** How the prompt should address images. */
  refAddressing: RefAddressingStyle;

  /** Max reference images (admin-uploaded). 0 means no refs. */
  maxReferences: number;

  /** Max input/subject images (user-uploaded + stage outputs). */
  maxSubjects: number;

  /** Total input image budget (refs + subjects combined). */
  maxImagesTotal: number;

  /** Does this model accept start/end frame pairs? (Kling) */
  acceptsStartEndImage?: boolean;

  /**
   * Can the model generate native audio (sfx / ambient / dialogue) via
   * an on/off switch? (Kling v3 Omni `sound`; Seedance uses its own
   * `generateAudio` config path.) Drives the create-flow sound toggle.
   */
  supportsSound?: boolean;

  /**
   * Selectable quality tiers (Kling `mode`: std=720p / pro=1080p / 4k).
   * Absent = the model has one fixed quality. Per-tier pricing lives in
   * `provider_models.tier_pricing`; the default tier is what old clients
   * (which never send a quality) are charged and served.
   */
  modes?: { values: readonly ('std' | 'pro' | '4k')[]; default: 'std' | 'pro' | '4k' };

  /**
   * Max prompt length in CHARACTERS for the user-facing "create" flow.
   *
   * Optional because it's only meaningful where the app lets an end-user
   * type a raw prompt (the mobile create screen). Values reflect provider
   * limits: Kling caps the API at 2 500 chars; Gemini image models are
   * token-based and effectively unbounded for a mobile box, so we set a
   * comfortable soft cap; Seedance's exact cap is unpublished so we use a
   * safe 2 500. When omitted, the client falls back to a conservative
   * default. Templates ignore this (their prompts are admin-authored).
   */
  maxPromptChars?: number;

  /** Admin-facing description shown next to the model picker. */
  notes?: string;
}

/* ── Registry ──────────────────────────────────────────────────────── */

const GEMINI_ASPECT_RATIOS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
] as const;

const GEMINI_31_FLASH_EXTRA = ['1:4', '4:1', '1:8', '8:1'] as const;

const GEMINI_RESOLUTIONS = ['1K', '2K', '4K'] as const;
const GEMINI_31_RESOLUTIONS = ['512', '1K', '2K', '4K'] as const;

const IMAGEN_ASPECT_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const;

const KLING_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
/**
 * Per Kling's own docs, `aspect_ratio` is NOT honored by v2-master
 * and v2.5-turbo — it was added in v2.6 and v3 Omni. For models that
 * lock the output to a single aspect, surface that single value so
 * the admin form renders a non-interactive read-only "16:9 (locked)"
 * row instead of pretending you can pick.
 */
const KLING_FIXED_ASPECT = ['16:9'] as const;
const KLING_DURATIONS = [5, 10] as const;
const KLING_OMNI_DURATIONS = [3, 5, 8, 10, 15] as const;

/**
 * Seedance 2.0 (BytePlus ModelArk) constants.
 *
 * Aspect ratios: the API accepts six ratios + `'adaptive'`. We expose
 * the named ratios in the admin UI; templates that want "match the
 * input image's aspect" use `'adaptive'`.
 *
 * Resolutions: 480p / 720p / 1080p / 2K. 720p is the documented
 * default and the cheapest above 480p — admin form will default here.
 *
 * Durations: 5 / 10s are the canonical menu values (the API technically
 * accepts any integer 4–15, but 5 and 10 cover virtually every template
 * pattern and keep the picker tidy).
 *
 * Reference limits per BytePlus docs:
 *   - up to 9 image references per request
 *   - up to 3 video references per request
 *   - up to 3 audio references per request
 *   We expose 9 in `maxReferences` (the dominant case — the admin form
 *   widens to videos/audio in a follow-up PR; the compiler already
 *   handles all three).
 */
const SEEDANCE_ASPECT_RATIOS = [
  '16:9', '9:16', '4:3', '3:4', '21:9', '1:1', 'adaptive',
] as const;
const SEEDANCE_RESOLUTIONS = ['480p', '720p', '1080p', '2K'] as const;
const SEEDANCE_DURATIONS = [5, 10] as const;

export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // ── Gemini (Nano Banana family) ─────────────────────────────────────
  'gemini-2.5-flash-image': {
    provider: 'gemini',
    modelKey: 'gemini-2.5-flash-image',
    displayName: 'Nano Banana (Gemini 2.5 Flash Image)',
    status: 'deprecated',
    kind: 'image',
    sizing: { mode: 'aspect', values: GEMINI_ASPECT_RATIOS },
    outputs: { min: 1, max: 4, default: 1 },
    refAddressing: 'ordinal',
    // Up to 3 images total works best per Google's own guidance.
    maxReferences: 3,
    maxSubjects: 3,
    maxImagesTotal: 3,
    notes: 'Older Nano Banana. Cheaper but lower fidelity than Nano Banana 2.',
  },
  'gemini-3.1-flash-image-preview': {
    provider: 'gemini',
    modelKey: 'gemini-3.1-flash-image-preview',
    displayName: 'Nano Banana 2 Flash (Gemini 3.1)',
    status: 'preview',
    kind: 'image',
    sizing: {
      mode: 'aspect',
      values: [...GEMINI_ASPECT_RATIOS, ...GEMINI_31_FLASH_EXTRA],
      resolutions: GEMINI_31_RESOLUTIONS,
    },
    outputs: { min: 1, max: 4, default: 1 },
    refAddressing: 'ordinal',
    // 10 high-fidelity object refs + 4 character refs, 14 total.
    maxReferences: 14,
    maxSubjects: 14,
    maxImagesTotal: 14,
    // Token-based limit is huge (~131K input tokens); comfortable mobile cap.
    maxPromptChars: 5000,
    notes: 'Fast tier of Gemini 3 image. Best for high-volume generation.',
  },
  'gemini-3-pro-image-preview': {
    provider: 'gemini',
    modelKey: 'gemini-3-pro-image-preview',
    displayName: 'Nano Banana Pro (Gemini 3 Pro Image)',
    status: 'preview',
    kind: 'image',
    sizing: {
      mode: 'aspect',
      values: GEMINI_ASPECT_RATIOS,
      resolutions: GEMINI_RESOLUTIONS,
    },
    outputs: { min: 1, max: 4, default: 1 },
    refAddressing: 'ordinal',
    // 6 object + 5 character refs, 14 total.
    maxReferences: 14,
    maxSubjects: 14,
    maxImagesTotal: 14,
    // Token-based limit is huge (~65K input tokens); comfortable mobile cap.
    maxPromptChars: 5000,
    notes: 'Highest quality. Slower & more expensive. Up to 4K outputs.',
  },

  // ── Imagen 4 (Google text-to-image) ─────────────────────────────────
  'imagen-4.0-generate-001': {
    provider: 'gemini',
    modelKey: 'imagen-4.0-generate-001',
    displayName: 'Imagen 4',
    status: 'active',
    kind: 'image',
    sizing: { mode: 'aspect', values: IMAGEN_ASPECT_RATIOS },
    outputs: { min: 1, max: 4, default: 1 },
    refAddressing: 'none',
    maxReferences: 0,
    maxSubjects: 0,
    maxImagesTotal: 0,
    notes: 'Pure text-to-image — does not accept any input images.',
  },
  'imagen-4.0-fast-generate-001': {
    provider: 'gemini',
    modelKey: 'imagen-4.0-fast-generate-001',
    displayName: 'Imagen 4 Fast',
    status: 'active',
    kind: 'image',
    sizing: { mode: 'aspect', values: IMAGEN_ASPECT_RATIOS },
    outputs: { min: 1, max: 4, default: 1 },
    refAddressing: 'none',
    maxReferences: 0,
    maxSubjects: 0,
    maxImagesTotal: 0,
    notes: 'Fast tier of Imagen 4. Lower latency, slightly lower fidelity.',
  },

  // ── Kling v2 family (legacy, single-image i2v) ──────────────────────
  // v2.6 was the breaking-change release that *added* `aspect_ratio`
  // and audio support; v2-master and v2.5-turbo still lock output to
  // their input's aspect or 16:9.
  'kling-v2-6': {
    provider: 'kling',
    modelKey: 'kling-v2-6',
    displayName: 'Kling V2.6',
    status: 'active',
    kind: 'video',
    sizing: { mode: 'aspect', values: KLING_ASPECT_RATIOS },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: KLING_DURATIONS, default: 5 },
    negativePrompt: true,
    refAddressing: 'none',
    maxReferences: 0,
    maxSubjects: 1,
    maxImagesTotal: 1,
    acceptsStartEndImage: true,
    // Kling API hard-caps the prompt at 2 500 characters.
    maxPromptChars: 2500,
    notes: 'First v2 model to honor aspect_ratio. Supports 16:9, 9:16, 1:1.',
  },
  'kling-v2-5-turbo': {
    provider: 'kling',
    modelKey: 'kling-v2-5-turbo',
    displayName: 'Kling V2.5 Turbo',
    status: 'active',
    kind: 'video',
    // Locked to the input's aspect — surfaced as a single-value list so
    // the admin form can render a read-only chip instead of a dropdown.
    sizing: { mode: 'aspect', values: KLING_FIXED_ASPECT },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: KLING_DURATIONS, default: 5 },
    negativePrompt: true,
    refAddressing: 'none',
    maxReferences: 0,
    maxSubjects: 1,
    maxImagesTotal: 1,
    acceptsStartEndImage: true,
    notes: 'Does NOT support aspect_ratio — output mirrors input image aspect.',
  },
  'kling-v2-master': {
    provider: 'kling',
    modelKey: 'kling-v2-master',
    displayName: 'Kling V2 Master',
    status: 'active',
    kind: 'video',
    sizing: { mode: 'aspect', values: KLING_FIXED_ASPECT },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: KLING_DURATIONS, default: 5 },
    negativePrompt: true,
    refAddressing: 'none',
    maxReferences: 0,
    maxSubjects: 1,
    maxImagesTotal: 1,
    acceptsStartEndImage: true,
    notes: 'Does NOT support aspect_ratio — output mirrors input image aspect.',
  },

  // ── Kling v3 Omni (unified multimodal) ──────────────────────────────
  'kling-v3-omni': {
    provider: 'kling',
    modelKey: 'kling-v3-omni',
    displayName: 'Kling 3 Omni',
    status: 'preview',
    kind: 'video',
    sizing: { mode: 'aspect', values: KLING_ASPECT_RATIOS },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: KLING_OMNI_DURATIONS, default: 5 },
    negativePrompt: true,
    refAddressing: 'angle',
    // The omni endpoint caps `image_list` at 7 entries TOTAL (start/end
    // frames included; drops to 4 when a reference video is attached —
    // video refs not wired yet). Was 9 before the 2026 docs pass.
    maxReferences: 7,
    maxSubjects: 2,
    maxImagesTotal: 7,
    acceptsStartEndImage: true,
    // Native audio via the `sound: on|off` request field.
    supportsSound: true,
    // Quality tiers — default `pro` matches what the adapter has always
    // sent, so pre-tier clients keep exactly their old behavior + price.
    modes: { values: ['std', 'pro', '4k'], default: 'pro' },
    // Kling API hard-caps the prompt at 2 500 characters.
    maxPromptChars: 2500,
    notes:
      'Unified text-to-video + image-to-video + multi-reference with optional native audio. Modes std (720p) / pro (1080p) / 4k. Prompt addresses references as <<<image_1>>>, <<<image_2>>>, …',
  },

  // ── Kling v3 (base) ─────────────────────────────────────────────────
  // Drop-in tier upgrade on the classic text2video/image2video
  // endpoints — same request shape as the v2 family with `model_name:
  // "kling-v3"`. Conservative capability set: the 3-ratio /5|10s config
  // is the cross-source-verified subset (mirrors conflict on wider
  // ratio/duration claims; widen only after a live check). Audio on the
  // base endpoints has a conflicting field name across mirrors — NOT
  // wired (Omni is the sound-capable pick).
  'kling-v3': {
    provider: 'kling',
    modelKey: 'kling-v3',
    displayName: 'Kling 3',
    status: 'preview',
    kind: 'video',
    sizing: { mode: 'aspect', values: KLING_ASPECT_RATIOS },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: KLING_DURATIONS, default: 5 },
    negativePrompt: true,
    refAddressing: 'none',
    maxReferences: 0,
    maxSubjects: 1,
    maxImagesTotal: 1,
    acceptsStartEndImage: true,
    // Quality tiers — default `pro` (1080p) anchors the sell price.
    modes: { values: ['std', 'pro', '4k'], default: 'pro' },
    // Kling API hard-caps the prompt at 2 500 characters.
    maxPromptChars: 2500,
    notes:
      'Kling 3.0 on the classic t2v/i2v endpoints. Modes std (720p) / pro (1080p) / 4k. Text-to-video works with no input image.',
  },

  // ── Seedance 2.0 (BytePlus ModelArk, dreamina-seedance family) ──────
  // Video model with optional native audio generation (sfx, ambient,
  // dialogue with lip-sync). Supports T2V, I2V, first/last frame
  // bookends, and multimodal references (images / videos / audio).
  // All inputs are sent via the `content[]` array on
  // POST /api/v3/contents/generations/tasks; ordering inside the array
  // determines first_frame vs last_frame vs reference_image when
  // combined with the per-item `role` field.
  //
  // `refAddressing: 'ordinal'` because Seedance prompts naturally
  // address images as "the first image" / "[image 1]" rather than
  // requiring a positional `@Image1` literal. Role tags on the
  // content array carry the structural meaning; the prompt language
  // describes intent.
  'dreamina-seedance-2-0-260128': {
    provider: 'seedance',
    modelKey: 'dreamina-seedance-2-0-260128',
    displayName: 'Seedance 2.0 (Standard)',
    status: 'preview',
    kind: 'video',
    sizing: {
      mode: 'aspect',
      values: SEEDANCE_ASPECT_RATIOS,
      resolutions: SEEDANCE_RESOLUTIONS,
    },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: SEEDANCE_DURATIONS, default: 5 },
    refAddressing: 'ordinal',
    maxReferences: 9,
    maxSubjects: 2, // first_frame + optional last_frame
    maxImagesTotal: 9,
    acceptsStartEndImage: true,
    // Exact cap unpublished; safe default matching the video peers.
    maxPromptChars: 2500,
    notes:
      'BytePlus Seedance 2.0. Supports T2V, I2V, first/last frame, multi-reference, native audio (lip-sync). Up to 1080p / 10s. ~$0.93 per 5s at 1080p.',
  },
  'dreamina-seedance-2-0-fast-260128': {
    provider: 'seedance',
    modelKey: 'dreamina-seedance-2-0-fast-260128',
    displayName: 'Seedance 2.0 Fast',
    status: 'preview',
    kind: 'video',
    sizing: {
      mode: 'aspect',
      values: SEEDANCE_ASPECT_RATIOS,
      resolutions: SEEDANCE_RESOLUTIONS,
    },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: SEEDANCE_DURATIONS, default: 5 },
    refAddressing: 'ordinal',
    maxReferences: 9,
    maxSubjects: 2,
    maxImagesTotal: 9,
    acceptsStartEndImage: true,
    notes:
      'Fast tier of Seedance 2.0 — ~20% cheaper, slightly lower fidelity. Same parameter surface as Standard.',
  },

  // ── GPT Image 2 (forward-looking — not wired to an adapter yet) ─────
  // Included so the admin form can preview the model picker and so we
  // can validate the capability shape against a non-Google,
  // non-aspect-ratio provider. The runtime adapter ships when we wire
  // OpenAI credentials.
  'gpt-image-2': {
    provider: 'gemini', // placeholder — narrow `Provider` union doesn't have 'openai' yet
    modelKey: 'gpt-image-2',
    displayName: 'GPT Image 2 (coming soon)',
    status: 'deprecated', // hidden from active picker until wired
    kind: 'image',
    sizing: {
      mode: 'pixels',
      presets: ['1024x1024', '1536x1024', '1024x1536'],
      divisibleBy: 16,
      maxEdge: 3840,
      minPixels: 655_360,
      maxPixels: 8_294_400,
    },
    outputs: { min: 1, max: 10, default: 1 },
    quality: { values: ['low', 'medium', 'high'], default: 'medium' },
    refAddressing: 'ordinal',
    maxReferences: 16,
    maxSubjects: 16,
    maxImagesTotal: 16,
    notes: 'Stub entry — pending OpenAI provider integration.',
  },
};

/**
 * Look up a model's capabilities. Throws if the key isn't known so the
 * caller surfaces a 4xx with a clear message instead of crashing later.
 */
export function getCapabilities(modelKey: string): ModelCapabilities {
  const cap = MODEL_CAPABILITIES[modelKey];
  if (!cap) {
    throw new Error(
      `Unknown model "${modelKey}". Add it to MODEL_CAPABILITIES in @clickfy/providers/capabilities.ts.`,
    );
  }
  return cap;
}

/** Optional accessor — returns `undefined` instead of throwing. */
export function findCapabilities(modelKey: string): ModelCapabilities | undefined {
  return MODEL_CAPABILITIES[modelKey];
}

/** All currently-active models, filtered by provider. */
export function listActiveModels(provider?: Provider): ModelCapabilities[] {
  return Object.values(MODEL_CAPABILITIES).filter(
    (m) => m.status !== 'deprecated' && (!provider || m.provider === provider),
  );
}
