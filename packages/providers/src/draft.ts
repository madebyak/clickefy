/**
 * Seedance Draft mode — what the final made from a draft costs.
 *
 * The final is served at `caps.draft.finalTier` and BytePlus reuses the
 * draft's duration, audio setting and reference media, so the charge is
 * the draft's own terms re-priced at the final tier: served audio,
 * billed duration (an `edit` bills the source clip) and input video,
 * exactly as the create route prices any submission. The create route
 * charges with this and the project assets list quotes with it, so the
 * figure on the tile is the figure that gets charged.
 */

import { resolveCreditCost } from '@clickfy/types';

import type { ModelCapabilities } from './capabilities';

/** The subset of a draft job's `options` its final is built and priced from. */
export interface DraftJobOptions {
  draft?: boolean;
  aspectRatio?: string;
  duration?: number;
  sound?: boolean;
  task?: 'edit' | 'extend';
  /** Probed reference-video length the draft was charged on (0 when none). */
  inputVideoSeconds?: number;
}

/** Credits for the final made from a draft with these options; 0 = no draft mode. */
export function draftFinalCost(args: {
  caps: ModelCapabilities;
  price: { costCredits: number; tierPricing: Record<string, number> | null };
  options: DraftJobOptions;
}): number {
  const { caps, price, options } = args;
  if (!caps.draft) return 0;
  const finalTier = caps.draft.finalTier;
  const refDuration = caps.duration?.default;
  const inputVideoSeconds = options.inputVideoSeconds ?? 0;
  const soundServed =
    options.sound === true &&
    caps.supportsSound === true &&
    !(caps.nativeAudioRequiresTier && finalTier !== caps.nativeAudioRequiresTier);
  const billedDuration =
    options.task === 'edit'
      ? Math.max(1, Math.ceil(inputVideoSeconds))
      : typeof options.duration === 'number'
        ? options.duration
        : refDuration;
  return resolveCreditCost({
    baseCredits: price.costCredits,
    tierPricing: price.tierPricing,
    mode: finalTier,
    sound: soundServed,
    duration: billedDuration,
    defaultDuration: refDuration,
    inputVideoSeconds,
    inputVideoFactor: caps.inputVideoDurationFactor,
  });
}
