/**
 * Brand logos for AI models and their providers.
 *
 * One map so the studio's model picker and the marketing model row can
 * never drift apart. Files live in `public/models/` (brand-coloured
 * 24×24 icon marks; `openai.svg` is `currentColor`, so it inherits the
 * surrounding text colour).
 *
 * Two lookups because the two surfaces key differently:
 *   - the studio knows a model's `provider` (from `GET /v1/models`);
 *   - a specific model logo wins over its provider's when we have one
 *     (e.g. Seedream has its own mark, ByteDance is the company behind it).
 */

/** Provider id (`provider_models.provider`) → logo path. */
const PROVIDER_LOGOS: Record<string, string> = {
  gemini: "/models/gemini-color.svg",
  kling: "/models/kling-color.svg",
  // Seedance is BytePlus/ByteDance's video model — the company mark is
  // the closest official brand asset for it.
  seedance: "/models/bytedance-color.svg",
  veo: "/models/veo.svg",
  openai: "/models/openai.svg",
};

/**
 * Exact model-key overrides, checked before the provider fallback.
 * Keys are `provider_models.model_key` values (or the marketing ids used
 * by the homepage row).
 */
const MODEL_LOGOS: Record<string, string> = {
  seedream: "/models/seedream.svg",
  "gpt-image": "/models/openai.svg",
};

/**
 * Resolve the best logo for a model. Pass the model key when you have
 * one; falls back to the provider mark, then to null so the caller can
 * render its own initial-letter placeholder.
 */
export function modelLogo(opts: { provider?: string; modelKey?: string }): string | null {
  if (opts.modelKey && MODEL_LOGOS[opts.modelKey]) return MODEL_LOGOS[opts.modelKey];
  if (opts.provider && PROVIDER_LOGOS[opts.provider]) return PROVIDER_LOGOS[opts.provider];
  return null;
}
