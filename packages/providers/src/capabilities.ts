/**
 * `MODEL_CAPABILITIES` — source of truth for what each AI model supports.
 *
 * The admin form reads from this registry to render the right config
 * controls (aspect-ratio dropdown vs. pixel dimensions; durations for
 * video models; how many references the model accepts). The
 * prompt-compiler reads from it to validate stage configs and to pick
 * the right image-addressing strategy (`ordinal` text-part labels for
 * Gemini, `@image_N` for Kling Omni, etc.).
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
      /**
       * Aspect ratios offered in the picker. Pixel-sized models still
       * need these: users choose a shape, not a pixel count, and the
       * compiler solves each ratio into exact dimensions that satisfy
       * the constraints below. Without it the model shows no ratio
       * control at all.
       */
      aspectRatios?: readonly string[];
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
 *  - `at`        → `@image_N` literal embedded in the prompt string
 *                  itself — Kling Omni / O1.
 *                  Kling's own docs give the form `@image_1`, `@Zhang`,
 *                  `@video_1`. An earlier `<<<image_N>>>` spelling here
 *                  came from third-party API mirrors, not Kuaishou, and
 *                  the model does not recognise it — references written
 *                  that way were silently ignored.
 *  - `none`      → model does not accept reference images (Imagen).
 */
export type RefAddressingStyle = 'ordinal' | 'at' | 'none';

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
  /**
   * The id actually sent to the provider, when it differs from `modelKey`.
   *
   * `modelKey` is our STABLE INTERNAL identifier: it is written into
   * `jobs.model_key`, into every `template_versions.snapshot`, and into
   * `provider_models` rows. Those are immutable history — renaming one
   * would mean rewriting audit data, and any snapshot we missed would
   * fail `findCapabilities()` with `unknown_model` (a non-refundable
   * error code, so users would be charged for the outage).
   *
   * `apiModelId` decouples that from the provider's own naming, which is
   * NOT stable — vendors retire preview aliases on their own schedule.
   * Set it to re-point an existing key at a new upstream id without
   * touching a single row.
   *
   * Defaults to `modelKey` when unset.
   */
  apiModelId?: string;
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
   * Kling only: how many library Elements a request may cite.
   *
   * Elements are persistent Kling-side entities, not uploads — see
   * `KlingElementRef`. 3.0 documents a hard cap of 3; Omni and O1 share
   * one budget with reference images (7 normally, 4 once a reference
   * video is involved), so the number here is their ceiling in the
   * simple case. 0 or absent means the endpoint does not accept them.
   */
  maxElements?: number;

  /**
   * Kling Omni / O1 only: the endpoints refuse Elements and a
   * first+last frame pair in the same request. Documented as "Using
   * first+last frames: Elements are not supported."
   */
  elementsExcludeEndFrame?: boolean;

  /**
   * Kling only: the minimum quality tier at which native audio is
   * available. Kling 2.6 documents `audio=native` as 1080p-only; the
   * 3.0 family has no such restriction.
   *
   * The tier is also the billed unit, so the compiler resolves the
   * conflict by dropping the audio rather than silently upgrading the
   * resolution — serving a tier the user was not charged for is a
   * revenue leak, and serving a cheaper one is a shortfall.
   */
  nativeAudioRequiresTier?: string;

  /**
   * Kling only: the minimum quality tier required when BOTH a first and
   * a last frame are supplied.
   *
   * Kling 2.6 and 2.5 Turbo both document first+last-frame generation as
   * 1080p-only; the 3.0 family has no such restriction. Resolved the
   * same way as `nativeAudioRequiresTier` — the tier is the billed unit,
   * so the compiler drops the END FRAME rather than silently upgrading
   * the resolution the user paid for.
   */
  endFrameRequiresTier?: string;

  /**
   * Kling only: the value `settings.audio` takes when sound is ON.
   *
   * Not cosmetic — the enum differs by model. 2.6 / 3.0 / 3.0 Omni use
   * `native` ("audio matching the visuals"); O1 uses `original` ("retains
   * the original sound of the reference video"), and rejects `native`.
   * Defaults to `native`.
   */
  soundOnValue?: 'native' | 'original';

  /**
   * Kling only: route this model through the API 2.0 client
   * (`adapters/kling-api2.ts`) instead of the legacy one.
   *
   * Per-model rather than global so the two generations can run side by
   * side and models move over one at a time. It travels WITH
   * `apiModelId`, which on API 2.0 is the URL path segment
   * (`kling-2.6`) rather than a body field — setting one without the
   * other sends the wrong model id to the wrong host.
   *
   * Kling 3.0 Turbo and O1 exist only on API 2.0, so they are always
   * flagged.
   */
  klingApi2?: boolean;

  /**
   * Seedream: does the model accept an `output_format` parameter?
   *
   * Not "does it support png" — Seedream 4.x rejects the FIELD itself
   * with `InvalidParameter: the parameter output_format is not supported
   * by the current model`, even when set to its own default of jpeg.
   * Only the 5.x line accepts it. Verified against the live API
   * 2026-08-15.
   */
  supportsOutputFormat?: boolean;

  /**
   * Can the model generate native audio (sfx / ambient / dialogue) via
   * an on/off switch? (Kling v3 Omni `sound`; Seedance uses its own
   * `generateAudio` config path.) Drives the create-flow sound toggle.
   */
  supportsSound?: boolean;

  /**
   * Selectable, separately-priced tiers. Absent = one fixed quality.
   *
   * The tier KEY is provider-specific and is what the user is billed on
   * (`provider_models.tier_pricing[key]`, absolute credits) and what the
   * compiler turns into the provider's own parameter:
   *
   *   Kling      std | pro | 4k        → `mode` (720p / 1080p / 4K)
   *   Gemini     1K | 2K | 4K | 512    → `imageConfig.imageSize`
   *   OpenAI     low | medium | high   → `quality`
   *
   * `labels` supplies the user-facing text; without it the key is shown
   * verbatim. Kling's keys are opaque (`std`) so they need labels;
   * Gemini's resolutions read fine as-is.
   *
   * `default` is what pre-tier clients — which never send a quality —
   * are both charged and served, so changing it changes a price.
   *
   * ⚠️ For Kling ONLY, the mere PRESENCE of this field also marks the
   * model text-to-video capable (compile.ts). Adding tiers to a Kling
   * model therefore changes endpoint selection; for every other provider
   * it is purely a pricing/UI concern.
   */
  modes?: {
    values: readonly string[];
    default: string;
    labels?: Readonly<Record<string, string>>;
  };

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

  /**
   * Seedance: does the model accept a `seed` body parameter?
   *
   * BytePlus documents `seed` for 1.5 pro / 1.0 pro / 1.0 pro fast ONLY.
   * The 2.x line does not take it, and the video API validates the body
   * strictly, so sending it risks a hard rejection on a job we have
   * already debited. Absent = never send it.
   */
  supportsSeed?: boolean;

  /**
   * Seedance: does the model accept a `camera_fixed` body parameter?
   *
   * Same story as `supportsSeed` — documented for 1.5 pro / 1.0 pro /
   * 1.0 pro fast only, and additionally unsupported in reference-image
   * scenarios even there. Absent = never send it.
   */
  supportsCameraFixed?: boolean;

  /**
   * Seedance: the model forces `ratio: 'adaptive'` whenever a first or
   * first+last frame is supplied, because it preserves the first frame's
   * own aspect ratio.
   *
   * Documented for Seedance 2.5 (the 2.0 series still accepts an
   * explicit ratio alongside frames). Sending a concrete ratio with a
   * frame on such a model is an invalid request — after the debit.
   */
  framesRatioAdaptiveOnly?: boolean;

  /**
   * Seedance 2.5: supports `omni_reference_task_type`, which moves
   * task-shape validation from an async failure (already queued, already
   * charged) to a synchronous rejection at submit time.
   */
  supportsOmniTaskType?: boolean;

  /**
   * Seedance: reference VIDEO input budget (`role: reference_video`).
   *
   * Verbatim from the BytePlus API reference + per-family tutorials
   * (2026-08-30): 2.5 takes 0-10 clips, 2-30s each, ≤30s combined; the
   * 2.0 family takes 0-3 clips, 2-15s each, ≤15s combined. mp4/mov,
   * ≤200MB (our upload cap of 25MB binds first). Absent = the model
   * does not accept reference video. Mutually exclusive with start/end
   * frames — the existing Frames ⇄ References split already models that.
   */
  referenceVideo?: {
    max: number;
    maxTotalSeconds: number;
    minClipSeconds: number;
    maxClipSeconds: number;
  };

  /**
   * Seedance: reference AUDIO input budget (`role: reference_audio`).
   * Same doc source: 2.5 takes 0-10 clips ≤30s combined; 2.0 family
   * 0-3 clips ≤15s combined. wav/mp3, ≤15MB per clip. Drives voice
   * timbre for prompt-written dialogue and music/SFX placement.
   */
  referenceAudio?: {
    max: number;
    maxTotalSeconds: number;
    minClipSeconds: number;
    maxClipSeconds: number;
  };

  /**
   * Seedance 2.0 family: audio references require at least one visual
   * reference (image or video) in the same request — audio-only input
   * is a 2.5-exclusive capability.
   */
  audioRefRequiresVisual?: boolean;

  /**
   * Seedance: extra effective output-seconds billed per second of INPUT
   * video (reference_video). BytePlus's token formula charges
   * (input + output duration) x pixels x fps at a ~40%-discounted
   * per-token rate whenever a request carries video — validated against
   * their published with-video price tables, 0.6 covers the worst
   * observed cost multiplier on every model/resolution with the
   * catalog's margin intact. Feeds `resolveCreditCost`'s
   * `inputVideoFactor`. Absent = input video adds no per-second charge
   * (Kling prices video input as `${tier}_videoin` rate keys instead).
   */
  inputVideoDurationFactor?: number;

  /**
   * Seedream: the model's `size` field also accepts an explicit
   * `WIDTHxHEIGHT` (BytePlus "Method 2"), which is the ONLY way to pin
   * an exact aspect ratio — there is no `aspect_ratio` parameter, and a
   * ratio described in prose is a suggestion the model often ignores.
   *
   * Both constraints must hold simultaneously: `width * height` inside
   * the pixel range, and `width / height` inside the ratio range. Note
   * the pixel bound applies to the PRODUCT, not to either edge.
   */
  pixelSizing?: {
    minPixels: number;
    maxPixels: number;
    /** Inclusive width/height bounds, e.g. 1/16 … 16. */
    minRatio: number;
    maxRatio: number;
    /** Where inside the range to aim — bigger is better up to the cap. */
    targetPixels: number;
    /** Round both edges to this multiple. */
    divisibleBy: number;
  };

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

/**
 * GPT Image 2 ratios. Ordered widest-portrait → widest-landscape so the
 * picker reads as a spectrum. Bounded by OpenAI's 1:3–3:1 constraint.
 */
const OPENAI_ASPECT_RATIOS = [
  '1:3', '9:21', '9:16', '2:3', '3:4', '4:5',
  '1:1',
  '5:4', '4:3', '3:2', '16:9', '21:9', '3:1',
] as const;

const KLING_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
/**
 * Per Kling's own docs, `aspect_ratio` is NOT honored by v2-master
 * and v2.5-turbo — it was added in v2.6 and v3 Omni. For models that
 * lock the output to a single aspect, surface that single value so
 * the admin form renders a non-interactive read-only "16:9 (locked)"
 * row instead of pretending you can pick.
 */
const KLING_FIXED_ASPECT = ['16:9'] as const;
/** v2 family (2.5-turbo, 2.6, v2-master): only 5s and 10s. */
const KLING_DURATIONS = [5, 10] as const;
/**
 * Kling 3.0 family (3.0, 3.0 Omni, 3.0 Turbo): every whole second from
 * 3 to 15. The previous `[3, 5, 8, 10, 15]` list was a guess from a
 * third-party mirror and made 8 of the 13 legal values unreachable.
 */
/** Kling O1 tops out at 10s, unlike the rest of the 3.0 family. */
const KLING_O1_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10] as const;

const KLING_3_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

/**
 * Seedance 2.0 (BytePlus ModelArk) constants.
 *
 * Aspect ratios: the API accepts six ratios + `'adaptive'`. We expose
 * the named ratios in the admin UI; templates that want "match the
 * input image's aspect" use `'adaptive'`.
 *
 * Resolutions are NOT uniform across the line, and getting this wrong
 * costs real money: an unsupported resolution is rejected by the API
 * *after* we have already debited credits. Only Seedance 2.0 Standard
 * goes above 720p. (`2K` was never a valid value — the top tier is
 * `4k`.)
 *
 * Durations: every whole second in the model's range, plus `-1` meaning
 * "let the model choose". Previously fixed at 5/10 to keep the picker
 * tidy, which silently hid most of the range.
 *
 * Reference limits per BytePlus docs (2.0 series):
 *   - up to 9 image references per request
 *   - up to 3 video references per request
 *   - up to 3 audio references per request
 */
const SEEDANCE_ASPECT_RATIOS = [
  '16:9', '9:16', '4:3', '3:4', '21:9', '1:1', 'adaptive',
] as const;
/** Seedance 2.0 Standard only. */
const SEEDANCE_RESOLUTIONS_FULL = ['480p', '720p', '1080p', '4k'] as const;
/** Seedance 2.0 Fast and 2.0 Mini cap at 720p. */
const SEEDANCE_RESOLUTIONS_SD = ['480p', '720p'] as const;
/**
 * Seedance 2.5. 1080p shipped 2026-08-14 (10-bit / H.265) and is a
 * separately-priced tier — see `price-models-2026-08.ts`.
 */
const SEEDANCE_RESOLUTIONS_25 = ['480p', '720p', '1080p'] as const;
/** Seedance 2.0 series: [4, 15]. */
const SEEDANCE_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
/** Seedance 2.5: [4, 30]. */
const SEEDANCE_25_DURATIONS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
] as const;

/**
 * Seedream — the IMAGE line on the same BytePlus ModelArk account.
 *
 * Ratios: Seedream has no `aspect_ratio` parameter at all. It infers the
 * shape from the prompt and reports what it produced in `data[].size`
 * (verified: asking for `1K` returned 1152x864, not a square). We still
 * declare the standard ratio menu because the compiler embeds the chosen
 * ratio into the prompt text — that is the only lever the API gives us.
 *
 * Resolutions differ per model and are NOT interchangeable:
 *   4.0      1K / 2K / 4K   — the only model accepting ~1 MP
 *   4.5      2K / 4K        — rejects anything under ~3.69 MP
 *   5.0 lite 2K / 3K / 4K   — same floor as 4.5
 *   5.0 pro  1K / 1.5K / 2K — cannot do 4K
 */
const SEEDREAM_ASPECT_RATIOS = [
  '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9',
] as const;

export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // ── Gemini (Nano Banana family) ─────────────────────────────────────
  //
  // Marketing names are aliases; the GA api ids are the `gemini-*-image`
  // strings. Verified live 2026-08-15 against our AI Studio key.
  //
  // The two `-preview` keys further down are LEGACY: they stay registered
  // because ~250 template snapshots have them frozen in, and they now
  // re-point at these same GA endpoints via `apiModelId`. New templates
  // and every create-flow pick should use the keys in this block.
  'gemini-3-pro-image': {
    provider: 'gemini',
    modelKey: 'gemini-3-pro-image',
    displayName: 'Nano Banana Pro',
    status: 'active',
    kind: 'image',
    sizing: {
      mode: 'aspect',
      values: GEMINI_ASPECT_RATIOS,
      resolutions: GEMINI_RESOLUTIONS,
    },
    outputs: { min: 1, max: 4, default: 1 },
    refAddressing: 'ordinal',
    // 6 object + 5 character + 3 style refs.
    maxReferences: 14,
    maxSubjects: 14,
    maxImagesTotal: 14,
    maxPromptChars: 5000,
    // 1K and 2K are the same price upstream ($0.134); 4K nearly doubles
    // it ($0.24), so resolution has to be a priced choice.
    modes: { values: ['1K', '2K', '4K'], default: '1K' },
    notes: 'Highest quality: best text rendering, style references, up to 4K.',
  },
  'gemini-3.1-flash-image': {
    provider: 'gemini',
    modelKey: 'gemini-3.1-flash-image',
    displayName: 'Nano Banana 2',
    status: 'active',
    kind: 'image',
    sizing: {
      mode: 'aspect',
      // Only model in the family that accepts the ultra-wide/tall ratios.
      values: [...GEMINI_ASPECT_RATIOS, ...GEMINI_31_FLASH_EXTRA],
      resolutions: GEMINI_31_RESOLUTIONS,
    },
    outputs: { min: 1, max: 4, default: 1 },
    refAddressing: 'ordinal',
    // 10 object + 4 character refs.
    maxReferences: 14,
    maxSubjects: 14,
    maxImagesTotal: 14,
    maxPromptChars: 5000,
    // Every tier is a different price: $0.045 / $0.067 / $0.101 / $0.151.
    modes: {
      values: ['512', '1K', '2K', '4K'],
      default: '1K',
      labels: { '512': '0.5K' },
    },
    notes: 'Balanced default: widest aspect + resolution range, 0.5K–4K.',
  },
  'gemini-3.1-flash-lite-image': {
    provider: 'gemini',
    modelKey: 'gemini-3.1-flash-lite-image',
    displayName: 'Nano Banana 2 Lite',
    status: 'active',
    kind: 'image',
    sizing: {
      mode: 'aspect',
      // Lite is 1K-only and sticks to the 10 standard ratios — it does NOT
      // take the ultra-wide set. Single-value `resolutions` renders the
      // control read-only rather than offering a choice that would 400.
      values: GEMINI_ASPECT_RATIOS,
      resolutions: ['1K'],
    },
    outputs: { min: 1, max: 4, default: 1 },
    refAddressing: 'ordinal',
    // Highest object-reference budget in the family (14), no character refs.
    maxReferences: 14,
    maxSubjects: 14,
    maxImagesTotal: 14,
    maxPromptChars: 5000,
    notes: 'Cheapest and fastest (sub-2s). 1K only, no search grounding.',
  },

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
  // ── LEGACY preview keys ─────────────────────────────────────────────
  // Kept registered so the ~250 template snapshots that reference them
  // still resolve; `apiModelId` re-points them at the GA endpoints above.
  // `deprecated` hides them from new pickers without breaking old work —
  // never delete a model entry (see the header note).
  'gemini-3.1-flash-image-preview': {
    provider: 'gemini',
    modelKey: 'gemini-3.1-flash-image-preview',
    // GA id is `gemini-3.1-flash-image` — same reasoning as Pro above.
    apiModelId: 'gemini-3.1-flash-image',
    displayName: 'Nano Banana 2 (legacy preview key)',
    status: 'deprecated',
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
    // Google GA'd this model as `gemini-3-pro-image`; the `-preview`
    // alias still resolves today but is on a vendor retirement path we
    // don't control, and 221 published templates have it frozen into
    // their version snapshots. Re-point the call, keep the key.
    // Verified 2026-08-15: both ids return an identical response shape
    // (candidates[].content.parts[].inlineData, image/jpeg, finishReason STOP).
    apiModelId: 'gemini-3-pro-image',
    displayName: 'Nano Banana Pro (legacy preview key)',
    status: 'deprecated',
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
    // Google retires all Imagen 4 models 2026-08-17. Zero templates
    // reference them and both were unpriced (0 credits), so this is a
    // no-op for users — deprecated rather than deleted so any snapshot
    // that ever named them still resolves instead of failing
    // `unknown_model` (a non-refundable error code).
    status: 'deprecated',
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
    // Google retires all Imagen 4 models 2026-08-17. Zero templates
    // reference them and both were unpriced (0 credits), so this is a
    // no-op for users — deprecated rather than deleted so any snapshot
    // that ever named them still resolves instead of failing
    // `unknown_model` (a non-refundable error code).
    status: 'deprecated',
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
    // API 2.0 puts the model in the URL path, not the body.
    apiModelId: 'kling-2.6',
    klingApi2: true,
    displayName: 'Kling V2.6',
    status: 'active',
    kind: 'video',
    sizing: { mode: 'aspect', values: KLING_ASPECT_RATIOS },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: KLING_DURATIONS, default: 5 },
    // API 2.0 has no `negative_prompt` field: the new per-model docs
    // don't list it and the adapter never sent it, so this flag being
    // true only produced an admin control whose value was silently
    // dropped on the wire. False on every `klingApi2` model until a
    // live probe proves the new API accepts the field.
    negativePrompt: false,
    refAddressing: 'none',
    maxReferences: 0,
    // Two images: `contents[]` accepts first_frame + last_frame. This was
    // 1, which capped `subjects` at one and made `endImage` — read as
    // `subjects[1]` by the compiler — permanently undefined, so the end
    // frame could never be sent however the admin configured the stage.
    maxSubjects: 2,
    maxImagesTotal: 2,
    acceptsStartEndImage: true,
    // 720p / 1080p only — 2.6 has no 4k tier, unlike 3.0.
    modes: {
      values: ['std', 'pro'],
      default: 'std',
      labels: { std: '720p', pro: '1080p' },
    },
    // 2.6 is the release that added native audio (`settings.audio`).
    // Upstream forces 1080p both when audio is on and when both frames
    // are used.
    supportsSound: true,
    nativeAudioRequiresTier: 'pro',
    endFrameRequiresTier: 'pro',
    // Kling API hard-caps the prompt at 2 500 characters.
    maxPromptChars: 2500,
    notes:
      'First v2 model to honor aspect_ratio (16:9, 9:16, 1:1) and the first with native audio. Native audio and first+last-frame both require 1080p.',
  },
  'kling-v2-5-turbo': {
    provider: 'kling',
    modelKey: 'kling-v2-5-turbo',
    // API 2.0 puts the model in the URL path, not the body.
    apiModelId: 'kling-2.5-turbo',
    klingApi2: true,
    displayName: 'Kling V2.5 Turbo',
    status: 'active',
    kind: 'video',
    // Locked to the input's aspect — surfaced as a single-value list so
    // the admin form can render a read-only chip instead of a dropdown.
    sizing: { mode: 'aspect', values: KLING_FIXED_ASPECT },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: KLING_DURATIONS, default: 5 },
    // See the kling-v2-6 note — API 2.0 has no negative_prompt field.
    negativePrompt: false,
    refAddressing: 'none',
    maxReferences: 0,
    // first_frame + last_frame, same as 2.6. See the note there for why
    // this being 1 silently disabled every end frame.
    maxSubjects: 2,
    maxImagesTotal: 2,
    acceptsStartEndImage: true,
    modes: {
      values: ['std', 'pro'],
      default: 'std',
      labels: { std: '720p', pro: '1080p' },
    },
    // No `settings.audio` on this endpoint — 2.6 is the first with it.
    endFrameRequiresTier: 'pro',
    notes:
      'Does NOT support aspect_ratio — output mirrors input image aspect. No native audio. First+last frame forces 1080p.',
  },
  'kling-v2-master': {
    provider: 'kling',
    modelKey: 'kling-v2-master',
    displayName: 'Kling V2 Master',
    // Kuaishou retires 2.0 Master (with the whole 1.x/2.1 legacy line)
    // on 2026-09-15 — new calls will fail after that date. Verified
    // 2026-08-27: zero templates, version snapshots, or jobs reference
    // it, so deprecating is a pure catalog cleanup.
    status: 'deprecated',
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
    // API 2.0 puts the model in the URL path, not the body.
    apiModelId: 'kling-3.0-omni',
    klingApi2: true,
    displayName: 'Kling 3 Omni',
    status: 'preview',
    kind: 'video',
    sizing: { mode: 'aspect', values: KLING_ASPECT_RATIOS },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: KLING_3_DURATIONS, default: 5 },
    // See the kling-v2-6 note — API 2.0 has no negative_prompt field.
    negativePrompt: false,
    refAddressing: 'at',
    // The omni endpoint caps `image_list` at 7 entries TOTAL (start/end
    // frames included; drops to 4 when a reference video is attached —
    // video refs not wired yet). Was 9 before the 2026 docs pass.
    maxReferences: 7,
    maxSubjects: 2,
    maxImagesTotal: 7,
    acceptsStartEndImage: true,
    // Shares the 7-image budget with reference images; drops to 4 once a
    // reference video is involved, which we do not send yet.
    maxElements: 7,
    elementsExcludeEndFrame: true,
    // Native audio via the `sound: on|off` request field.
    supportsSound: true,
    // Quality tiers — default `pro` matches what the adapter has always
    // sent, so pre-tier clients keep exactly their old behavior + price.
    modes: {
      values: ['std', 'pro', '4k'],
      default: 'pro',
      labels: { std: '720p', pro: '1080p', '4k': '4K' },
    },
    // Kling API hard-caps the prompt at 2 500 characters.
    maxPromptChars: 2500,
    notes:
      'Unified text-to-video + image-to-video + multi-reference with optional native audio. Modes std (720p) / pro (1080p) / 4k. Prompt addresses references as @image_1, @image_2, …',
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
    // API 2.0 puts the model in the URL path, not the body.
    apiModelId: 'kling-3.0',
    klingApi2: true,
    displayName: 'Kling 3',
    status: 'preview',
    kind: 'video',
    sizing: { mode: 'aspect', values: KLING_ASPECT_RATIOS },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: KLING_3_DURATIONS, default: 5 },
    // See the kling-v2-6 note — API 2.0 has no negative_prompt field.
    negativePrompt: false,
    // `POST /image-to-video/kling-3.0` accepts `contents[{type:'element'}]`
    // addressed from the prompt as `@name`, capped at 3 by the docs.
    // Elements are pre-registered library entities rather than
    // per-request uploads, so they are NOT interchangeable with our
    // GenerationReference images and `maxReferences` stays 0.
    refAddressing: 'at',
    maxReferences: 0,
    maxElements: 3,
    // first_frame + last_frame. Was 1, which made the end frame
    // unreachable and — because the admin gates its whole reference
    // block on capability — is why Kling 3 showed neither control.
    maxSubjects: 2,
    maxImagesTotal: 2,
    acceptsStartEndImage: true,
    // `settings.audio: native | off`, confirmed on both the t2v and i2v
    // pages. Previously unwired: the field name conflicted across
    // third-party mirrors and was left out pending a first-party source.
    supportsSound: true,
    // Quality tiers — default `pro` (1080p) anchors the sell price.
    modes: {
      values: ['std', 'pro', '4k'],
      default: 'pro',
      labels: { std: '720p', pro: '1080p', '4k': '4K' },
    },
    // Kling API hard-caps the prompt at 2 500 characters.
    maxPromptChars: 2500,
    notes:
      'Kling 3.0. first_frame + optional last_frame; up to 3 library Elements (not yet wired). Native audio via settings.audio. Modes std (720p) / pro (1080p) / 4k. Text-to-video works with no input image.',
  },

  // ── Kling 3.0 Turbo ─────────────────────────────────────────────────
  // The cheapest, most constrained member of the 3.0 family: its
  // `contents[]` accepts ONLY `prompt` and `first_frame`. No last frame,
  // no elements, no audio, no 4k. Everything omitted below is omitted
  // because the endpoint does not document it, not because it is
  // untested.
  'kling-v3-turbo': {
    provider: 'kling',
    modelKey: 'kling-v3-turbo',
    apiModelId: 'kling-3.0-turbo',
    klingApi2: true,
    displayName: 'Kling 3 Turbo',
    status: 'preview',
    kind: 'video',
    sizing: { mode: 'aspect', values: KLING_ASPECT_RATIOS },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: KLING_3_DURATIONS, default: 5 },
    // See the kling-v2-6 note — API 2.0 has no negative_prompt field.
    negativePrompt: false,
    refAddressing: 'none',
    maxReferences: 0,
    maxSubjects: 1,
    maxImagesTotal: 1,
    // Explicitly false: `last_frame` is not in this endpoint's enum.
    acceptsStartEndImage: false,
    modes: {
      values: ['std', 'pro'],
      default: 'std',
      labels: { std: '720p', pro: '1080p' },
    },
    maxPromptChars: 2500,
    notes:
      'Kling 3.0 Turbo. First frame only — no end frame, no elements, no native audio, no 4k. Durations 3-15s.',
  },

  // ── Kling O1 ────────────────────────────────────────────────────────
  // Same omni-style `contents[]` as 3.0 Omni (frames, refer_image,
  // feature_video, base_video, element) on `/omni-video/kling-o1`, but
  // capped at 1080p / 10s, and its audio switch means "keep the source
  // video's sound" rather than "generate matching audio".
  'kling-o1': {
    provider: 'kling',
    modelKey: 'kling-o1',
    apiModelId: 'kling-o1',
    klingApi2: true,
    displayName: 'Kling O1',
    status: 'preview',
    kind: 'video',
    sizing: { mode: 'aspect', values: KLING_ASPECT_RATIOS },
    outputs: { min: 1, max: 1, default: 1 },
    // 3-10s, unlike the 3-15s of the rest of the 3.0 family. Note the
    // docs add: a first frame with no other reference collapses this to
    // 5 or 10 only — a conditional we do not model yet.
    duration: { values: KLING_O1_DURATIONS, default: 5 },
    // See the kling-v2-6 note — API 2.0 has no negative_prompt field.
    negativePrompt: false,
    refAddressing: 'at',
    // Reference images ride the same 7-image budget as Omni; Elements
    // are library entities and not wired yet.
    maxReferences: 7,
    maxSubjects: 2,
    maxImagesTotal: 7,
    acceptsStartEndImage: true,
    maxElements: 7,
    elementsExcludeEndFrame: true,
    supportsSound: true,
    // O1 rejects `native`; its enum is `original | off`.
    soundOnValue: 'original',
    modes: {
      values: ['std', 'pro'],
      // 720p, matching the endpoint's own default and the cheapest tier.
      default: 'std',
      labels: { std: '720p', pro: '1080p' },
    },
    maxPromptChars: 2500,
    notes:
      'Kling O1 on /omni-video. Frames + reference images + reference videos. Audio switch keeps the source video sound (original), it does not synthesise. 720p/1080p, 3-10s.',
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
  // `refAddressing: 'ordinal'` — role tags on the content array carry the
  // structural meaning and ordinal prose ("the first image") is what the
  // compiler emits. BytePlus's own examples DO use a positional `@Image1`
  // / `@Video1` token, which is a different spelling from Kling's
  // `@image_1`; switching to it is a behaviour change we have no evidence
  // is an improvement, so it stays a documented option rather than a
  // silent swap. (Unlike Kling, the ordinal form here was never broken.)
  //
  // Note `generate_audio` defaults to TRUE upstream. We always send it
  // explicitly so a silent default cannot bill us for audio nobody asked
  // for; `supportsSound` is what exposes the toggle to users.
  'dreamina-seedance-2-0-260128': {
    provider: 'seedance',
    modelKey: 'dreamina-seedance-2-0-260128',
    displayName: 'Seedance 2.0 (Standard)',
    status: 'preview',
    kind: 'video',
    sizing: {
      mode: 'aspect',
      values: SEEDANCE_ASPECT_RATIOS,
      resolutions: SEEDANCE_RESOLUTIONS_FULL,
    },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: SEEDANCE_DURATIONS, default: 5 },
    refAddressing: 'ordinal',
    maxReferences: 9,
    maxSubjects: 2, // first_frame + optional last_frame
    maxImagesTotal: 9,
    acceptsStartEndImage: true,
    supportsSound: true,
    inputVideoDurationFactor: 0.6,
    referenceVideo: { max: 3, maxTotalSeconds: 15, minClipSeconds: 2, maxClipSeconds: 15 },
    referenceAudio: { max: 3, maxTotalSeconds: 15, minClipSeconds: 2, maxClipSeconds: 15 },
    audioRefRequiresVisual: true,
    // Exact cap unpublished; safe default matching the video peers.
    // Resolution is a PRICED tier here, not a free-form config: BytePlus
    // bills per second and the rate spans 11x between 480p and 4K, so a
    // single flat price either loses money at the top or is absurd at
    // the bottom. Keys are the resolution strings the API accepts.
    modes: {
      values: ['480p', '720p', '1080p', '4k'],
      default: '720p',
      labels: { '4k': '4K' },
    },
    maxPromptChars: 2500,
    notes:
      'BytePlus Seedance 2.0 Standard — the only model in the line above 720p (480p/720p/1080p/4k). T2V, I2V, first/last frame, up to 9 references, native audio with lip-sync. 4–15s. Reference images and start/end frames cannot be combined.',
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
      // NOT the same ladder as Standard: Fast tops out at 720p. Offering
      // 1080p/4k here produced a provider rejection *after* the debit.
      resolutions: SEEDANCE_RESOLUTIONS_SD,
    },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: SEEDANCE_DURATIONS, default: 5 },
    refAddressing: 'ordinal',
    maxReferences: 9,
    maxSubjects: 2,
    maxImagesTotal: 9,
    acceptsStartEndImage: true,
    supportsSound: true,
    inputVideoDurationFactor: 0.6,
    referenceVideo: { max: 3, maxTotalSeconds: 15, minClipSeconds: 2, maxClipSeconds: 15 },
    referenceAudio: { max: 3, maxTotalSeconds: 15, minClipSeconds: 2, maxClipSeconds: 15 },
    audioRefRequiresVisual: true,
    modes: {
      values: ['480p', '720p'],
      default: '720p',
    },
    maxPromptChars: 2500,
    notes:
      'Fast tier of Seedance 2.0 — ~20% cheaper, slightly lower fidelity. 480p/720p only, unlike Standard. Otherwise the same parameter surface.',
  },

  // ── Seedance 2.5 ────────────────────────────────────────────────────
  // The capability jump over 2.0: 30-second output, 30 reference
  // images, and reference VIDEO and AUDIO alongside images. Same
  // endpoint and key as the rest of the ModelArk line.
  //
  // `duration` documents a default of -1 ("model picks a length in
  // range"). We default the picker to 5s instead: -1 makes the cost of a
  // generation unknowable before it runs, and we debit up front. -1 stays
  // legal for templates that want it.
  //
  // Ceiling here is 720p, NOT 1080p — see the resolution constant.
  'dreamina-seedance-2-5-260628': {
    provider: 'seedance',
    modelKey: 'dreamina-seedance-2-5-260628',
    displayName: 'Seedance 2.5',
    status: 'preview',
    kind: 'video',
    sizing: {
      mode: 'aspect',
      values: SEEDANCE_ASPECT_RATIOS,
      resolutions: SEEDANCE_RESOLUTIONS_25,
    },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: SEEDANCE_25_DURATIONS, default: 5 },
    refAddressing: 'ordinal',
    maxReferences: 30,
    maxSubjects: 2, // first_frame + optional last_frame
    maxImagesTotal: 30,
    acceptsStartEndImage: true,
    supportsSound: true,
    inputVideoDurationFactor: 0.6,
    referenceVideo: { max: 10, maxTotalSeconds: 30, minClipSeconds: 2, maxClipSeconds: 30 },
    referenceAudio: { max: 10, maxTotalSeconds: 30, minClipSeconds: 2, maxClipSeconds: 30 },
    // A first / first+last frame makes 2.5 preserve that frame's own
    // aspect ratio; `ratio` then only accepts `adaptive`. Sending a
    // concrete ratio alongside a frame is rejected — after the debit.
    framesRatioAdaptiveOnly: true,
    supportsOmniTaskType: true,
    modes: {
      values: SEEDANCE_RESOLUTIONS_25,
      default: '720p',
    },
    maxPromptChars: 2500,
    notes:
      'BytePlus Seedance 2.5. Up to 30s and 30 reference images, plus reference video (<=10, <=30s total) and reference audio (<=10 clips, <=30s total). 480p/720p/1080p (1080p is 10-bit H.265). Also supports edit and extend task types via omni_reference_task_type. Billed per second of output.',
  },
  // Cheapest tier of the 2.0 line. Same parameter surface as Fast.
  'dreamina-seedance-2-0-mini-260615': {
    provider: 'seedance',
    modelKey: 'dreamina-seedance-2-0-mini-260615',
    displayName: 'Seedance 2.0 Mini',
    status: 'preview',
    kind: 'video',
    sizing: {
      mode: 'aspect',
      values: SEEDANCE_ASPECT_RATIOS,
      resolutions: SEEDANCE_RESOLUTIONS_SD,
    },
    outputs: { min: 1, max: 1, default: 1 },
    duration: { values: SEEDANCE_DURATIONS, default: 5 },
    refAddressing: 'ordinal',
    maxReferences: 9,
    maxSubjects: 2,
    maxImagesTotal: 9,
    acceptsStartEndImage: true,
    supportsSound: true,
    inputVideoDurationFactor: 0.6,
    referenceVideo: { max: 3, maxTotalSeconds: 15, minClipSeconds: 2, maxClipSeconds: 15 },
    referenceAudio: { max: 3, maxTotalSeconds: 15, minClipSeconds: 2, maxClipSeconds: 15 },
    audioRefRequiresVisual: true,
    modes: {
      values: ['480p', '720p'],
      default: '720p',
    },
    maxPromptChars: 2500,
    notes:
      'Cheapest tier of the Seedance 2.0 line. 480p/720p, 4-15s, up to 9 references. Same parameter surface as Fast.',
  },

  // ── Seedream (BytePlus ModelArk — image line) ───────────────────────
  //
  // Same provider tag, host and API key as Seedance video; only the path
  // differs (`/images/generations`, synchronous). All ids live-probed
  // 2026-08-15 and confirmed valid + activated on our account.
  //
  // Model ids MUST carry their date stamp — ModelArk documents no undated
  // alias, and `dola-seedream-5-0-lite-260128` (the spelling on Google's,
  // sorry, BytePlus's own deprecation page) returns NotFound. The `dola-`
  // prefix belongs to 5.0 pro alone.
  'seedream-4-0-250828': {
    provider: 'seedance',
    modelKey: 'seedream-4-0-250828',
    displayName: 'Seedream 4.0',
    status: 'active',
    kind: 'image',
    // The only Seedream that accepts ~1 MP; 4.5 and 5.0-lite floor at
    // ~3.69 MP. Flat price across every tier.
    sizing: { mode: 'aspect', values: SEEDREAM_ASPECT_RATIOS, resolutions: ['1K', '2K', '4K'] },
    // `size` doubles as an exact WIDTHxHEIGHT field — the only lever that
    // actually pins the aspect ratio (there is no `aspect_ratio` param and
    // a ratio written into the prompt is routinely ignored). Price is flat
    // per image regardless of dimensions, so aiming at ~2048² costs the
    // same as the 1K keyword this used to fall back to.
    pixelSizing: {
      minPixels: 921_600,
      maxPixels: 16_777_216,
      minRatio: 1 / 16,
      maxRatio: 16,
      targetPixels: 4_194_304,
      divisibleBy: 16,
    },
    outputs: { min: 1, max: 15, default: 1 },
    refAddressing: 'ordinal',
    maxReferences: 14,
    maxSubjects: 14,
    maxImagesTotal: 14,
    maxPromptChars: 2500,
    // 4.x rejects the `output_format` field outright — see the flag's doc.
    supportsOutputFormat: false,
    notes: 'Cheapest Seedream. Only one accepting 1K. jpeg output only.',
  },
  'seedream-5-0-260128': {
    provider: 'seedance',
    modelKey: 'seedream-5-0-260128',
    displayName: 'Seedream 5.0 Lite',
    status: 'active',
    kind: 'image',
    sizing: { mode: 'aspect', values: SEEDREAM_ASPECT_RATIOS, resolutions: ['2K', '3K', '4K'] },
    // Same story as 4.0, but this model FLOORS at ~3.69 MP — a 1024x1024
    // that looks perfectly reasonable is a hard error here, which is why
    // the bounds live in the registry rather than in the compiler.
    pixelSizing: {
      minPixels: 3_686_400,
      maxPixels: 16_777_216,
      minRatio: 1 / 16,
      maxRatio: 16,
      targetPixels: 4_194_304,
      divisibleBy: 16,
    },
    outputs: { min: 1, max: 15, default: 1 },
    refAddressing: 'ordinal',
    maxReferences: 14,
    maxSubjects: 14,
    maxImagesTotal: 14,
    maxPromptChars: 2500,
    supportsOutputFormat: true,
    notes: 'Best all-round Seedream: png output, up to 4K, multi-image.',
  },

  // ── OpenAI ──────────────────────────────────────────────────────────
  'gpt-image-2': {
    provider: 'openai',
    modelKey: 'gpt-image-2',
    // Pin the dated snapshot on the wire so a silent upstream revision
    // can't change output or price under us; `gpt-image-2` alone floats.
    apiModelId: 'gpt-image-2-2026-04-21',
    displayName: 'GPT Image 2',
    status: 'active',
    kind: 'image',
    // Pixel-sized rather than aspect-ratio'd — the only model in the
    // roster that works this way. Constraints are OpenAI's documented
    // limits and were already correct in the original stub.
    sizing: {
      mode: 'pixels',
      presets: ['1024x1024', '1536x1024', '1024x1536'],
      // Every ratio inside OpenAI's 1:3–3:1 window. Each solves to exact
      // dimensions with 0% ratio error (see `resolvePixelSize`), so these
      // are true shapes rather than approximations. 1:4/4:1 and beyond
      // are deliberately absent — they are outside the limit and would be
      // rejected after the credits were spent.
      aspectRatios: OPENAI_ASPECT_RATIOS,
      divisibleBy: 16,
      maxEdge: 3840,
      minPixels: 655_360,
      maxPixels: 8_294_400,
    },
    // The API documents n up to 10, but the count is not confirmed for
    // this model specifically and each image is billed, so we keep the
    // same one-image-per-job contract as every other provider.
    outputs: { min: 1, max: 1, default: 1 },
    // Quality spans a 35x price range ($0.006 low → $0.211 high), so it
    // is a genuine user-facing choice rather than a fixed setting.
    quality: { values: ['low', 'medium', 'high'], default: 'medium' },
    refAddressing: 'ordinal',
    maxReferences: 16,
    maxSubjects: 16,
    maxImagesTotal: 16,
    // Docs say 32,000 characters; keep the roster's comfortable cap.
    maxPromptChars: 5000,
    // $0.006 / $0.053 / $0.211 — a 35x span, so this must be user-visible.
    // Mirrors `quality.values`; `modes` is the priced/billable view of it.
    modes: {
      values: ['low', 'medium', 'high'],
      default: 'medium',
      labels: { low: 'Draft', medium: 'Standard', high: 'High' },
    },
    notes: 'Strongest text rendering. Quality tier drives a 35x price swing.',
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
/**
 * Aspect ratios a model offers, regardless of how it sizes internally.
 *
 * Aspect-mode models list them directly; pixel-mode models (GPT Image)
 * carry them alongside their pixel constraints. Three call sites need
 * this — the roster DTO, submission validation and the compiler — and
 * they must agree, or the picker offers a ratio the API then rejects.
 */
export function aspectRatiosFor(caps: ModelCapabilities): string[] {
  if (caps.sizing.mode === 'aspect') return [...caps.sizing.values];
  return [...(caps.sizing.aspectRatios ?? [])];
}

export function listActiveModels(provider?: Provider): ModelCapabilities[] {
  return Object.values(MODEL_CAPABILITIES).filter(
    (m) => m.status !== 'deprecated' && (!provider || m.provider === provider),
  );
}
