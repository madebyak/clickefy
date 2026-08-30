/**
 * Create-flow model roster (v1).
 *
 * The prompt-first "create" flow only exposes a curated, priced subset of
 * the capability registry. This module is the single source of truth for:
 *   - which models are create-eligible (the allow-list),
 *   - their commercial display names (what the mobile dropdown shows),
 *   - each model's attachment UI shape,
 * merged at request time with the code capability registry (aspect ratios,
 * durations, image budget, prompt cap) and the DB price
 * (`provider_models.cost_credits`).
 *
 * Adding a model = one entry here (plus a priced `provider_models` row).
 */

import { aspectRatiosFor, findCapabilities } from '@clickfy/providers';

/**
 * How the mobile create screen renders image attachments for a model:
 *   - `references` — a grid of reference/subject images (Gemini image models).
 *   - `frames`     — a start frame (+ optional end frame) (Kling video).
 *   - `seedance`   — a "Frames ⇄ References" toggle (BytePlus forbids mixing).
 */
export type CreateAttachmentMode = 'references' | 'frames' | 'seedance';

interface CreateModelDef {
  modelKey: string;
  /** Commercial name shown in the picker (registry displayName is internal). */
  name: string;
  attachments: CreateAttachmentMode;
  /** Image-to-video only — a start frame is mandatory (Kling 2.6). */
  requiresStartFrame: boolean;
  /** Whether an end/last frame slot is offered in v1. */
  supportsEndFrame: boolean;
}

/** The v1 roster, in dropdown display order (image first, then video). */
export const CREATE_MODEL_DEFS: readonly CreateModelDef[] = [
  // Gemini image roster on the GA model keys. The `-preview` keys these
  // replaced are still registered in MODEL_CAPABILITIES (deprecated) so
  // existing template snapshots resolve, but they are deliberately absent
  // here — the create flow only ever offers current models.
  {
    modelKey: 'gemini-3-pro-image',
    name: 'Nano Banana Pro',
    attachments: 'references',
    requiresStartFrame: false,
    supportsEndFrame: false,
  },
  {
    modelKey: 'gemini-3.1-flash-image',
    name: 'Nano Banana 2',
    attachments: 'references',
    requiresStartFrame: false,
    supportsEndFrame: false,
  },
  {
    modelKey: 'gemini-3.1-flash-lite-image',
    name: 'Nano Banana 2 Lite',
    attachments: 'references',
    requiresStartFrame: false,
    supportsEndFrame: false,
  },
  {
    modelKey: 'gpt-image-2',
    name: 'GPT Image 2',
    attachments: 'references',
    requiresStartFrame: false,
    supportsEndFrame: false,
  },
  {
    modelKey: 'kling-v3-omni',
    name: 'Kling 3 Omni',
    attachments: 'frames',
    requiresStartFrame: false,
    supportsEndFrame: true,
  },
  {
    modelKey: 'kling-v3',
    name: 'Kling 3',
    attachments: 'frames',
    requiresStartFrame: false,
    supportsEndFrame: true,
  },
  {
    modelKey: 'kling-v3-turbo',
    name: 'Kling 3 Turbo',
    attachments: 'frames',
    requiresStartFrame: false,
    // The turbo endpoint's `contents[]` takes prompt + first_frame only.
    supportsEndFrame: false,
  },
  {
    modelKey: 'kling-o1',
    name: 'Kling O1',
    attachments: 'frames',
    requiresStartFrame: false,
    supportsEndFrame: true,
  },
  {
    modelKey: 'kling-v2-6',
    name: 'Kling 2.6',
    attachments: 'frames',
    // `first_frame` is required by the endpoint; `last_frame` is
    // optional and IS supported — this said false, which hid the end
    // frame slot on a model that accepts one.
    requiresStartFrame: true,
    supportsEndFrame: true,
  },
  {
    modelKey: 'kling-v2-5-turbo',
    name: 'Kling 2.5 Turbo',
    attachments: 'frames',
    requiresStartFrame: false,
    supportsEndFrame: true,
  },
  {
    modelKey: 'seedream-4-0-250828',
    name: 'Seedream 4',
    attachments: 'references',
    requiresStartFrame: false,
    supportsEndFrame: false,
  },
  {
    modelKey: 'seedream-5-0-260128',
    name: 'Seedream 5 Lite',
    attachments: 'references',
    requiresStartFrame: false,
    supportsEndFrame: false,
  },
  {
    modelKey: 'dola-seedream-5-0-pro-260628',
    name: 'Seedream 5 Pro',
    attachments: 'references',
    requiresStartFrame: false,
    supportsEndFrame: false,
  },
  {
    modelKey: 'dreamina-seedance-2-5-260628',
    name: 'Seedance 2.5',
    attachments: 'seedance',
    requiresStartFrame: false,
    supportsEndFrame: true,
  },
  {
    modelKey: 'dreamina-seedance-2-0-260128',
    name: 'Seedance 2',
    attachments: 'seedance',
    requiresStartFrame: false,
    supportsEndFrame: true,
  },
  {
    modelKey: 'dreamina-seedance-2-0-fast-260128',
    name: 'Seedance 2 Fast',
    attachments: 'seedance',
    requiresStartFrame: false,
    supportsEndFrame: true,
  },
  {
    modelKey: 'dreamina-seedance-2-0-mini-260615',
    name: 'Seedance 2 Mini',
    attachments: 'seedance',
    requiresStartFrame: false,
    supportsEndFrame: true,
  },
];

const DEF_BY_KEY = new Map(CREATE_MODEL_DEFS.map((d) => [d.modelKey, d]));

export function getCreateModelDef(modelKey: string): CreateModelDef | undefined {
  return DEF_BY_KEY.get(modelKey);
}

export function isCreateEligible(modelKey: string): boolean {
  return DEF_BY_KEY.has(modelKey);
}

/** Conservative fallback prompt cap when a model omits `maxPromptChars`. */
export const DEFAULT_CREATE_PROMPT_CHARS = 2500;

/** The client-facing model DTO (mirrored in the SDK as `GenModel`). */
export interface CreateModelDTO {
  modelKey: string;
  provider: string;
  name: string;
  kind: 'image' | 'video';
  costCredits: number;
  maxPromptChars: number;
  aspectRatios: string[];
  /** Video durations in seconds; empty for image models. */
  durations: number[];
  /**
   * Kling O1: the collapsed duration list that applies while the
   * composer holds a start frame and nothing else — the picker filters
   * to it so the server never has to 422.
   */
  bareStartFrameDurations?: number[];
  /**
   * The length `costCredits` is quoted at. Clients need it to show the
   * same price the server will charge — without it the composer can
   * only display the tier price and silently under-states any clip
   * longer than the default.
   */
  defaultDuration?: number;
  /** Total input-image budget. */
  maxImages: number;
  attachments: CreateAttachmentMode;
  requiresStartFrame: boolean;
  supportsEndFrame: boolean;
  /** Native-audio toggle (Kling 3 Omni `sound`). */
  supportsSound: boolean;
  /**
   * The minimum tier at which native audio actually plays (Kling 2.6:
   * 1080p only). Below it the compiler drops the audio rather than
   * upgrading the billed tier, so the composer must gate the toggle —
   * otherwise the user pays the silent price and gets a silent clip
   * with no explanation.
   */
  soundRequiresTier?: string;
  /**
   * Selectable quality tiers with their per-tier prices (models with
   * modes only — Kling std=720p / pro=1080p / 4k). Absent = fixed
   * quality at `costCredits`.
   *
   * `soundCostCredits` is the tier's price with native audio ON, where
   * the provider bills audio at a higher rate (Kling). Absent = sound
   * costs the same as silent at this tier.
   *
   * `videoInCostCredits` is the tier's price when the request carries an
   * input/reference video (Kling bills video-input at a 1.5x per-second
   * rate). Absent = no rate change for video input at this tier.
   */
  tiers?: {
    mode: string;
    label: string;
    costCredits: number;
    soundCostCredits?: number;
    videoInCostCredits?: number;
  }[];
  /** The pre-selected tier (what `costCredits` reflects). */
  defaultTier?: string;
  /**
   * The provider ignores/forbids an explicit aspect ratio once a start
   * frame is attached (Kling omits the field; Seedance 2.5 accepts only
   * `adaptive`). The composer disables the ratio picker in that state so
   * it never shows a control that does nothing.
   */
  aspectLockedByStartFrame?: boolean;
  /**
   * Seedance: extra effective output-seconds billed per second of input
   * video — the composer's price preview must apply it exactly like the
   * server (`resolveCreditCost.inputVideoFactor`). Absent = input video
   * is priced via `videoInCostCredits` (Kling) or not accepted at all.
   */
  inputVideoFactor?: number;
  /**
   * Reference VIDEO clips the model accepts (Seedance). The composer
   * gates its attachment policy and pre-checks clip durations on this;
   * absent = the model takes no video references.
   */
  referenceVideo?: {
    max: number;
    maxTotalSeconds: number;
    minClipSeconds: number;
    maxClipSeconds: number;
  };
  /** Reference AUDIO clips (Seedance); absent = none accepted. */
  referenceAudio?: {
    max: number;
    maxTotalSeconds: number;
    minClipSeconds: number;
    maxClipSeconds: number;
  };
  /** Seedance 2.0 family: audio refs need an image/video alongside. */
  audioRefRequiresVisual?: boolean;
  /**
   * Seedance 2.5: the model takes `task: 'edit' | 'extend'` requests —
   * the composer offers its Edit/Extend modes only when this is true.
   */
  supportsVideoTasks?: boolean;
}

/**
 * Tier labels now live on the capability entry (different providers mean
 * different things by a tier — Kling resolution, Gemini image size,
 * OpenAI quality). Fall back to the key itself, which reads fine for the
 * resolution-style keys.
 */
function tierLabel(caps: { modes?: { labels?: Readonly<Record<string, string>> } }, key: string) {
  return caps.modes?.labels?.[key] ?? key;
}

/**
 * Build the client DTO for a create-eligible model by merging its roster
 * def, the code capability registry, and its DB price. Returns null if the
 * model isn't in the registry (misconfigured) — callers filter those out.
 */
export function buildCreateModelDTO(
  modelKey: string,
  costCredits: number,
  tierPricing?: Record<string, number> | null,
): CreateModelDTO | null {
  const def = DEF_BY_KEY.get(modelKey);
  const caps = findCapabilities(modelKey);
  if (!def || !caps) return null;

  // Shared accessor: pixel-sized models (GPT Image) carry their ratios
  // too, and the picker must show them.
  const aspectRatios = aspectRatiosFor(caps);
  const durations = caps.kind === 'video' && caps.duration ? [...caps.duration.values] : [];

  // Per-tier prices: absolute credits from `tier_pricing`, falling back
  // to the flat base for any tier the admin hasn't priced explicitly.
  const tiers = caps.modes
    ? caps.modes.values.map((m) => ({
        mode: m,
        label: tierLabel(caps, m),
        costCredits: tierPricing?.[m] ?? costCredits,
        // `${tier}_audio` / `${tier}_videoin` keys in the same
        // tier_pricing JSONB — see `resolveCreditCost`. Absent key =
        // no surcharge on that dimension.
        soundCostCredits: tierPricing?.[`${m}_audio`],
        videoInCostCredits: tierPricing?.[`${m}_videoin`],
      }))
    : undefined;

  return {
    modelKey,
    provider: caps.provider,
    name: def.name,
    kind: caps.kind,
    costCredits,
    maxPromptChars: caps.maxPromptChars ?? DEFAULT_CREATE_PROMPT_CHARS,
    aspectRatios,
    durations,
    bareStartFrameDurations: caps.bareStartFrameDurations
      ? [...caps.bareStartFrameDurations]
      : undefined,
    defaultDuration: caps.kind === 'video' ? caps.duration?.default : undefined,
    maxImages: caps.maxImagesTotal,
    attachments: def.attachments,
    requiresStartFrame: def.requiresStartFrame,
    supportsEndFrame: def.supportsEndFrame,
    supportsSound: caps.supportsSound ?? false,
    soundRequiresTier: caps.nativeAudioRequiresTier,
    tiers,
    defaultTier: caps.modes?.default,
    aspectLockedByStartFrame:
      caps.kind === 'video' && (caps.provider === 'kling' || caps.framesRatioAdaptiveOnly === true)
        ? true
        : undefined,
    inputVideoFactor: caps.inputVideoDurationFactor,
    referenceVideo: caps.referenceVideo ? { ...caps.referenceVideo } : undefined,
    referenceAudio: caps.referenceAudio ? { ...caps.referenceAudio } : undefined,
    audioRefRequiresVisual: caps.audioRefRequiresVisual,
    supportsVideoTasks:
      caps.supportsOmniTaskType === true && caps.referenceVideo !== undefined
        ? true
        : undefined,
  };
}
