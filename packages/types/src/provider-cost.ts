/**
 * What a generation costs US, in dollars — the provider's side of the
 * price book.
 *
 * WHY COMPUTED, NOT REPORTED
 *   No provider returns the cost of an individual request. fal's usage
 *   API has no request id; BytePlus, Kling, Gemini and OpenAI return
 *   token or second counts at best, prices never. So cost = the rate card
 *   × the units the job actually consumed, worked out the moment the job
 *   finishes and frozen on the row. Where a provider does return the
 *   billed quantity (Gemini Omni's video tokens) that quantity is used
 *   and the row is marked `exact`; otherwise `computed`. Rows back-filled
 *   from history are `estimated`. The admin dashboard shows the basis.
 *
 * THE RATE CARD
 *   `packages/db/pricing/cost-basis-2026-09.json` is the source for every
 *   model that existed in September; its numbers are copied here verbatim
 *   (a script must not read a JSON file at runtime in a Worker). The
 *   Phase 2 models (October 2026) carry the rates read from the vendors'
 *   pages on 2026-10-04/05, at REGULAR prices, never promotions.
 *
 *   Seedance is the only non-linear one: BytePlus bills completion tokens,
 *   tokens = (input_seconds + output_seconds) × width × height × 24 / 1024,
 *   with a floor when a video is attached. Dimensions here are the 16:9
 *   group; other aspect groups differ by a few percent, which is why a
 *   Seedance row is `computed`, never `exact`.
 */

export type CostBasis = 'exact' | 'computed' | 'estimated';

export interface ProviderCostInput {
  modelKey: string;
  /** The billed tier (`jobs.options.mode`), e.g. `720p`, `pro`, `high`, `1K`. */
  mode?: string | null;
  /** Output length in seconds (video). */
  durationSeconds?: number | null;
  /** Attached source clip length (Seedance edit/extend, Kling video refs, upscaler source). */
  inputVideoSeconds?: number | null;
  /** Number of outputs billed (images). Default 1. */
  outputs?: number;
  /** Reference images sent (Gemini / Seedream bill them). Default 0. */
  references?: number;
  /** Native audio requested and served. */
  sound?: boolean;
  /** Upscaler settings. */
  upscale?: { fps?: number | null; tier?: string | null } | null;
  /** Requested aspect ratio (GPT Image size bands). */
  aspectRatio?: string | null;
  /** What the provider reported, when it reports anything. */
  usage?: { videoTokens?: number | null; durationSec?: number | null } | null;
  /** `provider_models.cost_per_call_usd`, for models this book does not know. */
  fallbackUsdPerCall?: number | null;
  /** Characters of input text (speech models bill on these). */
  textChars?: number | null;
}

export interface ProviderCost {
  usd: number;
  basis: CostBasis;
  unit: 'second' | 'image' | 'call' | 'token' | 'megapixel' | 'character';
  quantity: number;
  unitPriceUsd: number;
  mode: string | null;
  note?: string;
}

type Rule =
  | { kind: 'per_image'; tiers: Record<string, number>; default: string; perReferenceUsd?: number; freeReferences?: number }
  | { kind: 'per_second'; tiers: Record<string, number>; default: string; defaultSeconds: number }
  | {
      kind: 'seedance_tokens';
      dims: Record<string, [number, number]>;
      ratePerMillion: Record<string, { noVideo: number; withVideo: number }>;
      default: string;
    }
  | { kind: 'upscale'; usdPerSecond: Record<string, number>; fps60Multiplier: number; proMultiplier: number; default: string }
  | { kind: 'video_tokens'; usdPerMillion: number; tokensPerSecond: Record<string, number>; default: string; assumedSeconds: number }
  /** Speech: the provider bills per character of input text. */
  | { kind: 'per_1k_chars'; usdPer1k: number; assumedChars: number };

/** GPT Image: quality × size band. Sizes beyond 1024² use the 2048×1152 band (landscape/portrait). */
const GPT_IMAGE_TIERS: Record<string, number> = {
  'low@1024x1024': 0.00588, 'medium@1024x1024': 0.05268, 'high@1024x1024': 0.21072,
  'low@2048x1152': 0.00471, 'medium@2048x1152': 0.04239, 'high@2048x1152': 0.1695,
  'low@2048x2048': 0.01191, 'medium@2048x2048': 0.10704, 'high@2048x2048': 0.42816,
};

const SEEDANCE_20_DIMS: Record<string, [number, number]> = { '480p': [864, 496], '720p': [1280, 720], '1080p': [1920, 1080], '4k': [3840, 2160] };
const SEEDANCE_25_DIMS: Record<string, [number, number]> = { '480p': [854, 480], '720p': [1280, 720], '1080p': [1920, 1080] };

export const PROVIDER_COST_BOOK: Record<string, Rule> = {
  // ── Google images (cost-basis-2026-09) ───────────────────────────────
  'gemini-3.1-flash-lite-image': { kind: 'per_image', tiers: { '1K': 0.0336 }, default: '1K', perReferenceUsd: 0.00014 },
  // ai.google.dev/gemini-api/docs/pricing, read 2026-10-06: $30/M output
  // tokens (1120 / 1680 / 2520 per image); input $1.50/M → ~560 tokens per
  // reference image.
  'gemini-nano-banana-2.1': { kind: 'per_image', tiers: { '1K': 0.0336, '2K': 0.0504, '4K': 0.0756 }, default: '1K', perReferenceUsd: 0.00084 },
  'gemini-3.1-flash-image': { kind: 'per_image', tiers: { '512': 0.04482, '1K': 0.0672, '2K': 0.1008, '4K': 0.1512 }, default: '1K', perReferenceUsd: 0.00028 },
  'gemini-3.1-flash-image-preview': { kind: 'per_image', tiers: { '512': 0.04482, '1K': 0.0672, '2K': 0.1008, '4K': 0.1512 }, default: '1K', perReferenceUsd: 0.00028 },
  'gemini-3-pro-image': { kind: 'per_image', tiers: { '1K': 0.1344, '2K': 0.1344, '4K': 0.24 }, default: '1K', perReferenceUsd: 0.00112 },
  'gemini-3-pro-image-preview': { kind: 'per_image', tiers: { '1K': 0.1344, '2K': 0.1344, '4K': 0.24 }, default: '1K', perReferenceUsd: 0.00112 },
  'gemini-2.5-flash-image': { kind: 'per_image', tiers: { '1K': 0.039 }, default: '1K' },
  'imagen-4.0-generate-001': { kind: 'per_image', tiers: { any: 0.04 }, default: 'any' },
  'imagen-4.0-fast-generate-001': { kind: 'per_image', tiers: { any: 0.02 }, default: 'any' },
  // ── OpenAI images: same token table for 2 and 2.5 ────────────────────
  'gpt-image-2': { kind: 'per_image', tiers: GPT_IMAGE_TIERS, default: 'medium@1024x1024', perReferenceUsd: 0.008192 },
  'gpt-image-2.5-sunburst': { kind: 'per_image', tiers: GPT_IMAGE_TIERS, default: 'medium@1024x1024', perReferenceUsd: 0.008192 },
  'gpt-image-2.5-flare': { kind: 'per_image', tiers: GPT_IMAGE_TIERS, default: 'medium@1024x1024', perReferenceUsd: 0.008192 },
  // ── BytePlus Seedream ────────────────────────────────────────────────
  'seedream-4-0-250828': { kind: 'per_image', tiers: { any: 0.03 }, default: 'any' },
  'seedream-5-0-260128': { kind: 'per_image', tiers: { any: 0.035 }, default: 'any' },
  'dola-seedream-5-0-pro-260628': { kind: 'per_image', tiers: { '1K': 0.045, '1.5K': 0.045, '2K': 0.09, any: 0.045 }, default: 'any', perReferenceUsd: 0.003, freeReferences: 1 },
  // ── Kling (per output second; `_audio` / `_videoin` variants) ────────
  'kling-v2-5-turbo': { kind: 'per_second', tiers: { std: 0.042, pro: 0.07 }, default: 'std', defaultSeconds: 5 },
  'kling-v2-6': { kind: 'per_second', tiers: { std: 0.042, pro: 0.07, pro_audio: 0.14 }, default: 'std', defaultSeconds: 5 },
  'kling-v2-master': { kind: 'per_second', tiers: { std: 0.28, pro: 0.28 }, default: 'std', defaultSeconds: 5 },
  'kling-v3': { kind: 'per_second', tiers: { std: 0.084, pro: 0.112, '4k': 0.42, std_audio: 0.126, pro_audio: 0.168, '4k_audio': 0.42 }, default: 'pro', defaultSeconds: 5 },
  'kling-v3-turbo': { kind: 'per_second', tiers: { std: 0.112, pro: 0.14 }, default: 'std', defaultSeconds: 5 },
  'kling-v3-omni': { kind: 'per_second', tiers: { std: 0.084, pro: 0.112, '4k': 0.42, std_audio: 0.112, pro_audio: 0.14, '4k_audio': 0.42, std_videoin: 0.126, pro_videoin: 0.168, '4k_videoin': 0.42 }, default: 'pro', defaultSeconds: 5 },
  'kling-o1': { kind: 'per_second', tiers: { std: 0.084, pro: 0.112, std_videoin: 0.126, pro_videoin: 0.168 }, default: 'std', defaultSeconds: 5 },
  // ── BytePlus Seedance (completion tokens) ────────────────────────────
  'dreamina-seedance-2-0-mini-260615': { kind: 'seedance_tokens', dims: SEEDANCE_20_DIMS, ratePerMillion: { '480p': { noVideo: 3.5, withVideo: 2.1 }, '720p': { noVideo: 3.5, withVideo: 2.1 } }, default: '720p' },
  'dreamina-seedance-2-0-fast-260128': { kind: 'seedance_tokens', dims: SEEDANCE_20_DIMS, ratePerMillion: { '480p': { noVideo: 5.6, withVideo: 3.3 }, '720p': { noVideo: 5.6, withVideo: 3.3 } }, default: '720p' },
  'dreamina-seedance-2-0-260128': { kind: 'seedance_tokens', dims: SEEDANCE_20_DIMS, ratePerMillion: { '480p': { noVideo: 7.0, withVideo: 4.3 }, '720p': { noVideo: 7.0, withVideo: 4.3 }, '1080p': { noVideo: 7.7, withVideo: 4.7 }, '4k': { noVideo: 4.0, withVideo: 2.4 } }, default: '720p' },
  'dreamina-seedance-2-5-260628': { kind: 'seedance_tokens', dims: SEEDANCE_25_DIMS, ratePerMillion: { '480p': { noVideo: 10.7, withVideo: 6.4 }, '720p': { noVideo: 10.7, withVideo: 6.4 }, '1080p': { noVideo: 11.7, withVideo: 7.0 } }, default: '720p' },
  // ── fal: ByteDance upscaler (per source second) ──────────────────────
  'bytedance-upscaler': { kind: 'upscale', usdPerSecond: { '1080p': 0.0072, '2k': 0.0144, '4k': 0.0288, '6k': 0.0576, '8k': 0.1152 }, fps60Multiplier: 2, proMultiplier: 10, default: '1080p' },
  // ── Phase 2 (regular prices, read 2026-10-04/05) ─────────────────────
  'wan-3-0': { kind: 'per_second', tiers: { '480p': 0.05, '720p': 0.1, '1080p': 0.2 }, default: '720p', defaultSeconds: 5 },
  'flux-3-image': { kind: 'per_image', tiers: { '512sq': 0.041, '768sq': 0.041, '1k': 0.048, '2k': 0.1, '4k': 0.607 }, default: '1k' },
  'flux-3-video': { kind: 'per_second', tiers: { '720p': 0.17, '1080p': 0.29 }, default: '720p', defaultSeconds: 5 },
  'h3-max': { kind: 'per_second', tiers: { '480P': 0.05, '768P': 0.08, '1080P': 0.16 }, default: '768P', defaultSeconds: 5 },
  'gemini-omni-1-1-flash': {
    kind: 'video_tokens',
    usdPerMillion: 17.5,
    // 360p measured on 2026-10-04 (5,793 tokens for 3 s); 720p from the docs; 1080p is 2.25× 720p by pixel count (estimate).
    tokensPerSecond: { '360p': 1931, '720p': 5792, '1080p': 13032 },
    default: '720p',
    assumedSeconds: 10,
  },
  // ── ElevenLabs (elevenlabs.io/pricing/api, read 2026-10-04; the plan rate, the API page lists $0.08) ──
  'eleven-tts': { kind: 'per_1k_chars', usdPer1k: 0.165, assumedChars: 1000 },
  // Sound effects and voice changer bill per minute of audio ($0.12/min) → $0.002 per second.
  'eleven-sfx': { kind: 'per_second', tiers: { std: 0.002 }, default: 'std', defaultSeconds: 10 },
  'eleven-sts': { kind: 'per_second', tiers: { std: 0.002 }, default: 'std', defaultSeconds: 60 },
};

/** Flux and friends don't exist in the book yet: an unknown model falls back to the row's reference USD. */
export function providerCostUsd(input: ProviderCostInput): ProviderCost | null {
  const rule = PROVIDER_COST_BOOK[input.modelKey];
  const outputs = Math.max(1, input.outputs ?? 1);
  const refs = Math.max(0, input.references ?? 0);

  if (!rule) {
    if (typeof input.fallbackUsdPerCall === 'number' && input.fallbackUsdPerCall > 0) {
      return {
        usd: round(input.fallbackUsdPerCall * outputs),
        basis: 'computed',
        unit: 'call',
        quantity: outputs,
        unitPriceUsd: input.fallbackUsdPerCall,
        mode: input.mode ?? null,
        note: 'not in the cost book; priced at the row reference cost',
      };
    }
    return null;
  }

  switch (rule.kind) {
    case 'per_image': {
      let key = input.mode && rule.tiers[input.mode] !== undefined ? input.mode : rule.default;
      // GPT Image: the tier key is quality@size; pick the size band from the aspect ratio.
      if (input.modelKey.startsWith('gpt-image')) {
        const quality = input.mode && ['low', 'medium', 'high'].includes(input.mode) ? input.mode : 'medium';
        const square = !input.aspectRatio || input.aspectRatio === '1:1';
        key = `${quality}@${square ? '1024x1024' : '2048x1152'}`;
      }
      const unit = rule.tiers[key] ?? rule.tiers[rule.default]!;
      const billableRefs = Math.max(0, refs - (rule.freeReferences ?? 0));
      const usd = unit * outputs + (rule.perReferenceUsd ?? 0) * billableRefs;
      return { usd: round(usd), basis: 'computed', unit: 'image', quantity: outputs, unitPriceUsd: unit, mode: key };
    }
    case 'per_second': {
      const base = input.mode && rule.tiers[input.mode] !== undefined ? input.mode : rule.default;
      // Kling variants: audio and video-input rates when the card has them.
      const withVideo = (input.inputVideoSeconds ?? 0) > 0 && rule.tiers[`${base}_videoin`] !== undefined;
      const withAudio = input.sound === true && rule.tiers[`${base}_audio`] !== undefined;
      const key = withVideo ? `${base}_videoin` : withAudio ? `${base}_audio` : base;
      const unit = rule.tiers[key] ?? rule.tiers[rule.default]!;
      const seconds = input.durationSeconds && input.durationSeconds > 0 ? input.durationSeconds : rule.defaultSeconds;
      return { usd: round(unit * seconds * outputs), basis: 'computed', unit: 'second', quantity: seconds * outputs, unitPriceUsd: unit, mode: key };
    }
    case 'seedance_tokens': {
      const mode = input.mode && rule.dims[input.mode] ? input.mode : rule.default;
      const [w, h] = rule.dims[mode] ?? rule.dims[rule.default]!;
      const out = input.durationSeconds && input.durationSeconds > 0 ? input.durationSeconds : 5;
      const inSec = Math.max(0, input.inputVideoSeconds ?? 0);
      const perSecond = (w * h * 24) / 1024;
      let tokens = (inSec + out) * perSecond;
      if (inSec > 0) tokens = Math.max(tokens, (out + Math.ceil((out * 2) / 3)) * perSecond);
      const rates = rule.ratePerMillion[mode] ?? rule.ratePerMillion[rule.default]!;
      const rate = inSec > 0 ? rates.withVideo : rates.noVideo;
      return {
        usd: round((tokens / 1_000_000) * rate * outputs),
        basis: 'computed',
        unit: 'token',
        quantity: Math.round(tokens) * outputs,
        unitPriceUsd: rate / 1_000_000,
        mode,
        note: `${w}x${h} × 24 fps${inSec > 0 ? ', video input' : ''}`,
      };
    }
    case 'upscale': {
      const res = input.mode && rule.usdPerSecond[input.mode] !== undefined ? input.mode : rule.default;
      const fps = input.upscale?.fps ?? 30;
      const pro = input.upscale?.tier === 'pro';
      const unit = rule.usdPerSecond[res]! * (fps > 30 ? rule.fps60Multiplier : 1) * (pro ? rule.proMultiplier : 1);
      const seconds = Math.max(1, Math.ceil(input.inputVideoSeconds ?? input.durationSeconds ?? 0));
      const key = `${res}${fps > 30 ? '_60' : ''}${pro ? '_pro' : ''}`;
      return { usd: round(unit * seconds), basis: 'computed', unit: 'second', quantity: seconds, unitPriceUsd: unit, mode: key };
    }
    case 'video_tokens': {
      const mode = input.mode && rule.tokensPerSecond[input.mode] !== undefined ? input.mode : rule.default;
      const perToken = rule.usdPerMillion / 1_000_000;
      if (typeof input.usage?.videoTokens === 'number' && input.usage.videoTokens > 0) {
        return { usd: round(input.usage.videoTokens * perToken), basis: 'exact', unit: 'token', quantity: input.usage.videoTokens, unitPriceUsd: perToken, mode };
      }
      const seconds = input.usage?.durationSec ?? input.durationSeconds ?? rule.assumedSeconds;
      const tokens = Math.round(rule.tokensPerSecond[mode]! * seconds);
      return { usd: round(tokens * perToken), basis: 'computed', unit: 'token', quantity: tokens, unitPriceUsd: perToken, mode, note: `${seconds}s assumed` };
    }
    case 'per_1k_chars': {
      const chars = input.textChars && input.textChars > 0 ? Math.round(input.textChars) : rule.assumedChars;
      const perChar = rule.usdPer1k / 1000;
      return {
        usd: round(chars * perChar * outputs),
        basis: 'computed',
        unit: 'character',
        quantity: chars * outputs,
        unitPriceUsd: perChar,
        mode: null,
        ...(input.textChars ? {} : { note: `${chars} characters assumed` }),
      };
    }
  }
}

/**
 * Does a FAILED generation still cost us? Per provider, by whether the
 * provider ever ran it. Input rejections (a real face, an unsafe prompt,
 * a bad file) are refused before any compute and bill nothing anywhere.
 */
export function failedCostFactor(args: {
  provider: string;
  /** The provider accepted and started the task (a task id exists / the call was made). */
  reachedProvider: boolean;
  /** `jobs.error.reason`, when the failure was classified. */
  reason?: string | null;
  errorCode?: string | null;
}): 0 | 1 {
  if (!args.reachedProvider) return 0;
  if (args.errorCode === 'r2_input_missing' || args.errorCode === 'unknown_model') return 0;
  if (args.reason && /^input_/.test(args.reason)) return 0;
  switch (args.provider) {
    case 'fal':
    // ElevenLabs deducts quota only when a request succeeds.
    case 'elevenlabs':
      // Queue failures and 422s are not billed; only COMPLETED results are.
      return 0;
    case 'gemini':
    case 'openai':
      // Billed per call, including safety refusals.
      return 1;
    case 'seedance':
    case 'kling':
      // Billed once the task ran, even if output moderation then failed.
      return 1;
    default:
      return 1;
  }
}

function round(n: number): number {
  return Math.round(n * 100000) / 100000;
}
