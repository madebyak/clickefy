/**
 * The one place a credit price is computed.
 *
 * WHY THIS EXISTS
 *
 * The same arithmetic was needed in four places that cannot import each
 * other — the job-create route, template costing, the web composer and
 * the mobile create screen — so it was written twice and omitted twice:
 *
 *   - `POST /v1/jobs/create` applied the tier AND the duration factor.
 *   - The web composer and the mobile create screen applied the tier and
 *     IGNORED duration, so the button read "168" on a 15-second Kling
 *     3.0 job the server then charged 504 for. The user was billed three
 *     times what they were shown.
 *   - Template costing applied NEITHER, so a 10-second stage was billed
 *     at the 5-second price.
 *
 * This module lives in `@clickfy/types` because that is the only package
 * every app already depends on, and it has no dependencies of its own —
 * a pricing helper must never be the reason a mobile bundle grows an
 * adapter layer.
 *
 * THE MODEL
 *
 * Two independent multipliers sit on top of a base credit price:
 *
 *   1. TIER — resolution / quality. Absolute credits per tier key from
 *      `provider_models.tier_pricing`, NOT a multiplier, because vendor
 *      pricing is not linear in resolution (Kling 3.0: 126 / 168 / 630
 *      for 720p / 1080p / 4K).
 *   2. DURATION — video only. Kling and Seedance both bill per SECOND,
 *      so a flat per-job price only breaks even at one length. Prices
 *      are quoted at the model's default duration and scale linearly
 *      from there.
 *   3. AUDIO — Kling only. Native audio is billed at a HIGHER per-second
 *      rate upstream (2.6 @1080p: 0.5 → 1.0 U/s; 3.0/Omni: 0.8 → 1.0-1.2
 *      U/s), so a sound-on job at the silent price loses up to half the
 *      provider cost. Audio prices live in the same `tier_pricing` JSONB
 *      under the convention key `${tier}_audio` — absolute credits, like
 *      every other tier key. A missing `_audio` key means "no surcharge"
 *      (Seedance bakes audio into its token billing; Kling 4k charges
 *      the same 3.0 U/s either way), which keeps the change data-driven
 *      and inert for every model that has no such key.
 *   4. INPUT VIDEO — both video providers bill a request that carries an
 *      input/reference video at a materially higher rate, in two
 *      different shapes, so this dimension has two levers:
 *
 *      - Kling (Omni / O1 `base_video` / `feature_video`): a flat
 *        per-second RATE SWAP — 0.6/0.8 U/s becomes 0.9/1.2, exactly
 *        1.5x on both tiers, regardless of the input clip's length (4K
 *        is 3.0 U/s either way). Modeled as `${tier}_videoin` keys in
 *        `tier_pricing`, mirroring `_audio`. Kling forbids native audio
 *        alongside video input, so `_videoin` takes precedence over
 *        `_audio` when both flags are somehow set.
 *      - Seedance (reference_video): token billing includes the INPUT
 *        video's duration — (input + output seconds) x pixels x fps —
 *        at a discounted per-token rate. Modeled as extra effective
 *        output-seconds: `inputVideoSeconds x inputVideoFactor` added to
 *        the duration term. The factor (0.6, from
 *        `capabilities.inputVideoDurationFactor`) was validated against
 *        BytePlus's published with-video price tables across every
 *        model/resolution: charging 0.6 extra seconds per input second
 *        covers the worst observed cost multiplier (4.19x at 30s input
 *        on 2.5) with the catalog's margin intact.
 *
 *      A model with neither `_videoin` keys nor a factor charges nothing
 *      extra — the dimension is data-driven and inert until fed.
 *
 * Rounding is `ceil`, so a fractional credit always favours the house
 * rather than leaking a fraction on every job.
 */

export interface CreditCostInputs {
  /**
   * `provider_models.cost_credits` — the price at the model's DEFAULT
   * tier and default duration.
   */
  baseCredits: number;
  /**
   * `provider_models.tier_pricing` — absolute credits keyed by tier.
   * Absent, or missing the selected key, falls back to `baseCredits`.
   */
  tierPricing?: Record<string, number> | null;
  /** Selected tier key (`std` / `pro` / `4k` / `1080p` / `high` / …). */
  mode?: string | null;
  /**
   * Native-audio toggle, as it will actually be SERVED. Callers gate this
   * on the model's `nativeAudioRequiresTier` first (the compiler drops
   * audio on an ineligible tier rather than upgrading it, so the charge
   * must drop with it). With `sound` on, the tier price is looked up
   * under `${mode}_audio` before falling back to the silent tier key.
   */
  sound?: boolean | null;
  /** Chosen clip length in seconds. Ignored for image models. */
  duration?: number | null;
  /**
   * The length `baseCredits` is quoted at — `capabilities.duration.default`.
   * When absent (image models, or an unknown model) duration scaling is
   * skipped entirely rather than guessed at.
   */
  defaultDuration?: number | null;
  /**
   * Total seconds of input/reference VIDEO attached to the request
   * (0 / absent = none). Must be the server-derived duration, never a
   * client claim — the provider bills us on the actual clip.
   */
  inputVideoSeconds?: number | null;
  /**
   * Seedance only: extra effective output-seconds billed per input
   * second (`capabilities.inputVideoDurationFactor`, 0.6). Absent means
   * the model either prices input video via `_videoin` tier keys
   * (Kling) or not at all.
   */
  inputVideoFactor?: number | null;
}

/**
 * Credits for ONE output at the given tier and duration.
 *
 * Returns 0 for an unpriced model; callers treat that as "refuse the
 * job" rather than "it's free".
 */
export function resolveCreditCost(input: CreditCostInputs): number {
  const inputVideoSeconds =
    typeof input.inputVideoSeconds === 'number' && input.inputVideoSeconds > 0
      ? input.inputVideoSeconds
      : 0;

  // Rate selection: video-in key > audio key > silent tier > base.
  // The video-in key wins over audio because Kling (the only provider
  // with either key) forbids native audio on requests that carry an
  // input video — the flags cannot both legitimately apply.
  const videoInPrice =
    inputVideoSeconds > 0 && input.mode && input.tierPricing
      ? input.tierPricing[`${input.mode}_videoin`]
      : undefined;
  const audioPrice =
    input.sound && input.mode && input.tierPricing
      ? input.tierPricing[`${input.mode}_audio`]
      : undefined;
  const tierPrice =
    input.mode && input.tierPricing ? input.tierPricing[input.mode] : undefined;
  const base = videoInPrice ?? audioPrice ?? tierPrice ?? input.baseCredits ?? 0;
  if (base <= 0) return 0;

  const chosen = input.duration;
  const reference = input.defaultDuration;
  // Seedance's token billing includes the input video's duration, so it
  // is charged as extra effective output-seconds. Only meaningful when
  // duration scaling itself is active (a reference length exists).
  const extraSeconds =
    inputVideoSeconds > 0 &&
    typeof input.inputVideoFactor === 'number' &&
    input.inputVideoFactor > 0
      ? inputVideoSeconds * input.inputVideoFactor
      : 0;
  // Guard every term: a zero or missing reference would divide by zero
  // or silently scale to nothing.
  const factor =
    typeof chosen === 'number' &&
    typeof reference === 'number' &&
    reference > 0 &&
    chosen > 0
      ? (chosen + extraSeconds) / reference
      : 1;

  return Math.ceil(base * factor);
}
