/**
 * From "what a stage ran" to "what it cost us" — the one place the
 * worker (live) and the back-fill script (history) agree on.
 *
 * Both hand in the same facts: the model, the stage config the compiler
 * read (`mode`, `duration`, `sound`), what the job carried about its
 * inputs (`inputVideoSeconds`, references, upscaler settings), what came
 * back (outputs, the clip's real length, the provider's usage report),
 * and the row's reference USD for a model the book does not know. The
 * rate card and the arithmetic live in `@clickfy/types/provider-cost`.
 */

import {
  providerCostUsd,
  failedCostFactor,
  type CostBasis,
  type ProviderCost,
} from '@clickfy/types';

import type { ModelCapabilities } from './capabilities';

export interface StageCostFacts {
  modelKey: string;
  provider: string;
  /** `stage.config.mode` (the billed tier) or `jobs.options.mode`. */
  mode?: string | null;
  /** `stage.config.duration` / `jobs.options.duration`. */
  durationSeconds?: number | null;
  /** `jobs.options.inputVideoSeconds` / `sourceSeconds`. */
  inputVideoSeconds?: number | null;
  sound?: boolean;
  aspectRatio?: string | null;
  upscale?: { fps?: number | null; tier?: string | null } | null;
  /** Reference images sent to the provider. */
  references?: number;
  /** Outputs the provider returned (0 for a failed stage). */
  outputs?: number;
  /** The produced clip's measured length, when known. */
  outputDurationSec?: number | null;
  /** The provider's usage report, when it gives one (Gemini Omni). */
  usage?: { videoTokens?: number | null; durationSec?: number | null } | null;
  /** `provider_models.cost_per_call_usd`, the fallback for unknown models. */
  fallbackUsdPerCall?: number | null;
  /** Characters of input text (speech). */
  textChars?: number | null;
}

export interface StageCost extends ProviderCost {
  stage: number;
  model: string;
  provider: string;
}

/** Cost of one COMPLETED stage. Null when neither the book nor the row can price it. */
export function stageCost(stage: number, facts: StageCostFacts, caps?: ModelCapabilities): StageCost | null {
  const isVideo = caps?.kind === 'video' || caps?.kind === 'audio';
  const cost = providerCostUsd({
    modelKey: facts.modelKey,
    mode: facts.mode ?? caps?.modes?.default ?? null,
    // The clip we got is the clip we paid for; fall back to what was asked.
    durationSeconds: isVideo
      ? (facts.outputDurationSec && facts.outputDurationSec > 0
          ? Math.round(facts.outputDurationSec)
          : (facts.durationSeconds ?? caps?.duration?.default ?? null))
      : null,
    inputVideoSeconds: facts.inputVideoSeconds ?? null,
    outputs: facts.outputs ?? 1,
    references: facts.references ?? 0,
    sound: facts.sound,
    aspectRatio: facts.aspectRatio ?? null,
    upscale: facts.upscale ?? null,
    usage: facts.usage ?? null,
    fallbackUsdPerCall: facts.fallbackUsdPerCall ?? null,
    textChars: facts.textChars ?? null,
  });
  if (!cost) return null;
  return { stage, model: facts.modelKey, provider: facts.provider, ...cost };
}

/**
 * Cost of a FAILED stage: the full computed cost when the provider ran
 * it and bills regardless, zero otherwise. `reachedProvider` is whether
 * the adapter was invoked (an execute error after submit, a task that
 * failed while polling); a compile error or a missing input never
 * reaches the provider.
 */
export function failedStageCost(
  stage: number,
  facts: StageCostFacts,
  caps: ModelCapabilities | undefined,
  failure: { reachedProvider: boolean; reason?: string | null; errorCode?: string | null },
): StageCost | null {
  const full = stageCost(stage, { ...facts, outputs: 1 }, caps);
  if (!full) return null;
  const factor = failedCostFactor({
    provider: facts.provider,
    reachedProvider: failure.reachedProvider,
    reason: failure.reason,
    errorCode: failure.errorCode,
  });
  return factor === 0
    ? { ...full, usd: 0, quantity: 0, note: `not billed on failure (${facts.provider})` }
    : { ...full, note: `${full.note ? full.note + '; ' : ''}billed although the job failed` };
}

/** Sum stages into the job-level columns. */
export function summariseJobCost(
  stages: StageCost[],
  override?: CostBasis,
): { usd: number; basis: CostBasis; units: Array<StageCost & { basis: CostBasis }> } {
  const usd = Math.round(stages.reduce((s, c) => s + c.usd, 0) * 100000) / 100000;
  // The job is only as exact as its least exact stage.
  const basis: CostBasis = override ?? (stages.every((s) => s.basis === 'exact') ? 'exact' : 'computed');
  return { usd, basis, units: stages.map((s) => ({ ...s, basis: override ?? s.basis })) };
}
