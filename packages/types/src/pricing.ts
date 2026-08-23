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
  /** Chosen clip length in seconds. Ignored for image models. */
  duration?: number | null;
  /**
   * The length `baseCredits` is quoted at — `capabilities.duration.default`.
   * When absent (image models, or an unknown model) duration scaling is
   * skipped entirely rather than guessed at.
   */
  defaultDuration?: number | null;
}

/**
 * Credits for ONE output at the given tier and duration.
 *
 * Returns 0 for an unpriced model; callers treat that as "refuse the
 * job" rather than "it's free".
 */
export function resolveCreditCost(input: CreditCostInputs): number {
  const tierPrice =
    input.mode && input.tierPricing ? input.tierPricing[input.mode] : undefined;
  const base = tierPrice ?? input.baseCredits ?? 0;
  if (base <= 0) return 0;

  const chosen = input.duration;
  const reference = input.defaultDuration;
  // Guard every term: a zero or missing reference would divide by zero
  // or silently scale to nothing.
  const factor =
    typeof chosen === 'number' &&
    typeof reference === 'number' &&
    reference > 0 &&
    chosen > 0
      ? chosen / reference
      : 1;

  return Math.ceil(base * factor);
}
