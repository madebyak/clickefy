/**
 * The Video Upscaler's option vocabulary, and the price key it produces.
 *
 * WHY THIS IS SHARED CODE AND NOT FIVE COPIES
 *
 * Four places need the same lists and the same arithmetic:
 *   - the web modal, to draw the controls and show a price,
 *   - the API's request schema, to refuse anything else,
 *   - the API's pricing, to charge for what was actually asked,
 *   - the compiler, to put it on the wire for fal.
 * Written separately they drift, and a drifted option list is a job that
 * is charged at one setting and run at another. `@clickfy/types` is the
 * one package all four already depend on.
 *
 * WHAT THE MONEY DEPENDS ON
 *
 * fal publishes three independent multipliers on a per-source-second
 * rate, and only these three:
 *
 *   resolution   1080p $0.0072/s · 2K $0.0144/s · 4K $0.0288/s
 *   frame rate   60fps doubles the cost of any resolution
 *   tier         `pro` is TEN TIMES `standard`/`fast`
 *
 * So the most expensive combination (4K, 60fps, pro) costs 80x the
 * cheapest, and a single flat price for the model would either lose
 * money on every pro job or price 1080p out of reach. `upscalePriceKey`
 * turns the three into ONE `tier_pricing` key — `4k_60_pro` — so the
 * existing `resolveCreditCost` lookup prices it with no new concept:
 * the same convention as Kling's `${tier}_audio` keys.
 *
 * Preset, fidelity and bit depth cost nothing extra and so do not
 * appear in the key.
 */

/**
 * Target resolutions.
 *
 * 6K and 8K are offered because the model does them, but fal publishes
 * prices only up to 4K. Their `tier_pricing` entries continue the
 * published doubling (1080p 1x, 2K 2x, 4K 4x → 6K 8x, 8K 16x), which
 * also tracks pixel count, and they must be checked against a real
 * invoice line the first time one runs.
 */
export const UPSCALE_RESOLUTIONS = ['1080p', '2k', '4k', '6k', '8k'] as const;
export type UpscaleResolution = (typeof UPSCALE_RESOLUTIONS)[number];

/**
 * Enhancement quality tier. `fast` and `standard` cost the same
 * upstream; `pro` is large-model restoration at 10x the price and a
 * materially longer wait.
 */
export const UPSCALE_TIERS = ['fast', 'standard', 'pro'] as const;
export type UpscaleTier = (typeof UPSCALE_TIERS)[number];

/** Scene presets. Free — they select a tuned pipeline, not more compute. */
export const UPSCALE_PRESETS = ['general', 'ugc', 'short_series', 'aigc', 'old_film'] as const;
export type UpscalePreset = (typeof UPSCALE_PRESETS)[number];

/**
 * Enhancement intensity. `high` keeps texture close to the source;
 * `medium` pushes the image further. (fal's naming is the opposite way
 * round from how it reads: "high fidelity" = a MILDER change.)
 */
export const UPSCALE_FIDELITIES = ['high', 'medium'] as const;
export type UpscaleFidelity = (typeof UPSCALE_FIDELITIES)[number];

/**
 * Output frame rate. The endpoint accepts any number from 24 to 120, but
 * only two are offered: fal prices "60fps" as a doubling and says
 * nothing about 120, so an unpriced rate is one we would be guessing the
 * cost of. Anything above 30 is billed at the 60fps rate.
 */
export const UPSCALE_FPS = [30, 60] as const;
export type UpscaleFps = (typeof UPSCALE_FPS)[number];

/**
 * Output colour depth. 10-bit and 12-bit are refused upstream unless the
 * tier is `pro`, so the UI gates them and the compiler drops them.
 */
export const UPSCALE_BIT_DEPTHS = [8, 10, 12] as const;
export type UpscaleBitDepth = (typeof UPSCALE_BIT_DEPTHS)[number];

/** Everything the user chooses beyond the target resolution. */
export interface UpscaleOptions {
  preset?: UpscalePreset;
  tier?: UpscaleTier;
  fps?: UpscaleFps;
  fidelity?: UpscaleFidelity;
  bitDepth?: UpscaleBitDepth;
}

/**
 * The defaults, in one place so the modal's initial state, the schema's
 * fallbacks and the compiler's fallbacks cannot disagree.
 *
 * `aigc` rather than fal's own `general`: what this upscales in practice
 * is footage our own models generated. `standard` rather than `fast`
 * because the price is identical and the result is better.
 */
export const UPSCALE_DEFAULTS = {
  resolution: '1080p' as UpscaleResolution,
  preset: 'aigc' as UpscalePreset,
  tier: 'standard' as UpscaleTier,
  fps: 30 as UpscaleFps,
  fidelity: 'high' as UpscaleFidelity,
  bitDepth: 8 as UpscaleBitDepth,
};

/** 10-bit and 12-bit output exist only on the `pro` tier. */
export function bitDepthAllowed(depth: UpscaleBitDepth, tier: UpscaleTier): boolean {
  return depth === 8 || tier === 'pro';
}

/**
 * The `tier_pricing` key for a combination — `1080p`, `4k_60`,
 * `2k_pro`, `4k_60_pro`.
 *
 * Order is fixed (resolution, rate, tier) and the plain resolution is
 * its own key, so the cheapest combination reads exactly like an
 * ordinary tier key and the catalogue stays legible.
 */
export function upscalePriceKey(
  resolution: string,
  fps: number | undefined,
  tier: string | undefined,
): string {
  const parts = [resolution];
  if (typeof fps === 'number' && fps > 30) parts.push('60');
  if (tier === 'pro') parts.push('pro');
  return parts.join('_');
}

/** Every price key the catalogue must carry, in catalogue order. */
export function allUpscalePriceKeys(): string[] {
  const keys: string[] = [];
  for (const res of UPSCALE_RESOLUTIONS) {
    for (const fps of UPSCALE_FPS) {
      for (const tier of ['standard', 'pro'] as const) {
        keys.push(upscalePriceKey(res, fps, tier));
      }
    }
  }
  return keys;
}
