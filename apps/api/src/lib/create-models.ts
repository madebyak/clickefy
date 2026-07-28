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

import { findCapabilities } from '@clickfy/providers';

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
  {
    modelKey: 'gemini-3-pro-image-preview',
    name: 'Nano Banana Pro',
    attachments: 'references',
    requiresStartFrame: false,
    supportsEndFrame: false,
  },
  {
    modelKey: 'gemini-3.1-flash-image-preview',
    name: 'Nano Banana 2',
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
    modelKey: 'kling-v2-6',
    name: 'Kling 2.6',
    attachments: 'frames',
    requiresStartFrame: true,
    supportsEndFrame: false,
  },
  {
    modelKey: 'dreamina-seedance-2-0-260128',
    name: 'Seedance 2',
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
  /** Total input-image budget. */
  maxImages: number;
  attachments: CreateAttachmentMode;
  requiresStartFrame: boolean;
  supportsEndFrame: boolean;
  /** Native-audio toggle (Kling 3 Omni `sound`). */
  supportsSound: boolean;
}

/**
 * Build the client DTO for a create-eligible model by merging its roster
 * def, the code capability registry, and its DB price. Returns null if the
 * model isn't in the registry (misconfigured) — callers filter those out.
 */
export function buildCreateModelDTO(modelKey: string, costCredits: number): CreateModelDTO | null {
  const def = DEF_BY_KEY.get(modelKey);
  const caps = findCapabilities(modelKey);
  if (!def || !caps) return null;

  const aspectRatios = caps.sizing.mode === 'aspect' ? [...caps.sizing.values] : [];
  const durations = caps.kind === 'video' && caps.duration ? [...caps.duration.values] : [];

  return {
    modelKey,
    provider: caps.provider,
    name: def.name,
    kind: caps.kind,
    costCredits,
    maxPromptChars: caps.maxPromptChars ?? DEFAULT_CREATE_PROMPT_CHARS,
    aspectRatios,
    durations,
    maxImages: caps.maxImagesTotal,
    attachments: def.attachments,
    requiresStartFrame: def.requiresStartFrame,
    supportsEndFrame: def.supportsEndFrame,
    supportsSound: caps.supportsSound ?? false,
  };
}
