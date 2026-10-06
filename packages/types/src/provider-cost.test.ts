/**
 * The cost book against the credit catalogue: at each model's default
 * settings, credits × $0.10 must sit at or above cost × 1.5 (the house
 * rule rounds UP), so a wrong rate here shows as a margin below 33%.
 */

import { describe, expect, it } from 'vitest';

import { PROVIDER_COST_BOOK, failedCostFactor, providerCostUsd } from './provider-cost';

describe('providerCostUsd', () => {
  it('prices Kling per second with audio and video-input variants', () => {
    expect(providerCostUsd({ modelKey: 'kling-v3', mode: 'pro', durationSeconds: 5 })?.usd).toBeCloseTo(0.56, 5);
    expect(providerCostUsd({ modelKey: 'kling-v3', mode: 'pro', durationSeconds: 10, sound: true })?.usd).toBeCloseTo(1.68, 5);
    const omni = providerCostUsd({ modelKey: 'kling-v3-omni', mode: 'pro', durationSeconds: 5, inputVideoSeconds: 4, sound: true });
    expect(omni?.mode).toBe('pro_videoin');
    expect(omni?.usd).toBeCloseTo(0.84, 5);
  });

  it('prices Seedance 2.5 by completion tokens, with the video-input floor', () => {
    // 5 s at 720p: 1280×720×24/1024 = 21,600 tokens/s → 108,000 tokens × $10.7/M
    const t2v = providerCostUsd({ modelKey: 'dreamina-seedance-2-5-260628', mode: '720p', durationSeconds: 5 });
    expect(t2v?.quantity).toBe(108000);
    expect(t2v?.usd).toBeCloseTo(1.1556, 4);
    // 5 s out with a 2 s input: max((2+5), 5+ceil(10/3)=9) = 9 s of tokens at the with-video rate
    const edit = providerCostUsd({ modelKey: 'dreamina-seedance-2-5-260628', mode: '720p', durationSeconds: 5, inputVideoSeconds: 2 });
    expect(edit?.quantity).toBe(9 * 21600);
    expect(edit?.usd).toBeCloseTo((9 * 21600 / 1e6) * 6.4, 4);
    // the production reality: 30 s at 480p
    const long = providerCostUsd({ modelKey: 'dreamina-seedance-2-5-260628', mode: '480p', durationSeconds: 30 });
    expect(long?.usd).toBeCloseTo((30 * 854 * 480 * 24 / 1024 / 1e6) * 10.7, 4);
  });

  it('prices images per output plus references', () => {
    expect(providerCostUsd({ modelKey: 'gemini-3-pro-image', mode: '2K', references: 3 })?.usd).toBeCloseTo(0.1344 + 3 * 0.00112, 5);
    expect(providerCostUsd({ modelKey: 'gpt-image-2.5-sunburst', mode: 'high', aspectRatio: '1:1' })?.usd).toBeCloseTo(0.21072, 5);
    expect(providerCostUsd({ modelKey: 'gpt-image-2.5-flare', mode: 'low', aspectRatio: '16:9' })?.mode).toBe('low@2048x1152');
    expect(providerCostUsd({ modelKey: 'dola-seedream-5-0-pro-260628', references: 1 })?.usd).toBeCloseTo(0.045, 5);
    expect(providerCostUsd({ modelKey: 'dola-seedream-5-0-pro-260628', references: 3 })?.usd).toBeCloseTo(0.045 + 2 * 0.003, 5);
  });

  it('prices the upscaler per source second with fps and pro multipliers', () => {
    expect(providerCostUsd({ modelKey: 'bytedance-upscaler', mode: '4k', inputVideoSeconds: 10 })?.usd).toBeCloseTo(0.288, 5);
    const pro60 = providerCostUsd({ modelKey: 'bytedance-upscaler', mode: '4k', inputVideoSeconds: 10, upscale: { fps: 60, tier: 'pro' } });
    expect(pro60?.mode).toBe('4k_60_pro');
    expect(pro60?.usd).toBeCloseTo(5.76, 5);
  });

  it('prices Gemini Omni exactly from reported tokens, else from assumed length', () => {
    const exact = providerCostUsd({ modelKey: 'gemini-omni-1-1-flash', mode: '360p', usage: { videoTokens: 5793 } });
    expect(exact?.basis).toBe('exact');
    expect(exact?.usd).toBeCloseTo(0.10138, 4);
    const computed = providerCostUsd({ modelKey: 'gemini-omni-1-1-flash', mode: '720p', usage: { durationSec: 10 } });
    expect(computed?.basis).toBe('computed');
    expect(computed?.usd).toBeCloseTo(1.0136, 3);
  });

  it('prices the fal models per unit', () => {
    expect(providerCostUsd({ modelKey: 'wan-3-0', mode: '1080p', durationSeconds: 10 })?.usd).toBeCloseTo(2.0, 5);
    expect(providerCostUsd({ modelKey: 'flux-3-image', mode: '4k' })?.usd).toBeCloseTo(0.607, 5);
    expect(providerCostUsd({ modelKey: 'flux-3-video', mode: '720p', durationSeconds: 8 })?.usd).toBeCloseTo(1.36, 5);
    expect(providerCostUsd({ modelKey: 'h3-max', mode: '768P', durationSeconds: 15 })?.usd).toBeCloseTo(1.2, 5);
  });

  it('prices ElevenLabs speech per character and effects per second', () => {
    const speech = providerCostUsd({ modelKey: 'eleven-tts', textChars: 2500 });
    expect(speech?.unit).toBe('character');
    expect(speech?.usd).toBeCloseTo(0.4125, 5);
    expect(providerCostUsd({ modelKey: 'eleven-sfx', durationSeconds: 30 })?.usd).toBeCloseTo(0.06, 5);
    expect(providerCostUsd({ modelKey: 'eleven-sts', durationSeconds: 90 })?.usd).toBeCloseTo(0.18, 5);
  });

  it('falls back to the row reference cost for an unknown model, and null without one', () => {
    expect(providerCostUsd({ modelKey: 'mystery', fallbackUsdPerCall: 0.2 })?.usd).toBe(0.2);
    expect(providerCostUsd({ modelKey: 'mystery' })).toBeNull();
  });

  it('keeps every default-tier margin at or above the house rule', () => {
    // credits as seeded in production for the default tier; cost at the default settings
    const credits: Record<string, number> = {
      'gemini-3-pro-image': 3, 'gemini-3.1-flash-image': 2, 'gemini-3.1-flash-lite-image': 1, 'gpt-image-2': 1,
      'kling-v2-5-turbo': 4, 'kling-v2-6': 4, 'kling-v3': 9, 'kling-v3-turbo': 9, 'kling-v3-omni': 9, 'kling-o1': 7,
      'dreamina-seedance-2-5-260628': 18, 'dreamina-seedance-2-0-260128': 12, 'dreamina-seedance-2-0-fast-260128': 10, 'dreamina-seedance-2-0-mini-260615': 6,
      'seedream-4-0-250828': 1, 'seedream-5-0-260128': 1, 'dola-seedream-5-0-pro-260628': 2, 'bytedance-upscaler': 1,
      'wan-3-0': 8, 'flux-3-image': 1, 'flux-3-video': 13, 'h3-max': 6, 'gemini-omni-1-1-flash': 16,
      'gpt-image-2.5-sunburst': 1, 'gpt-image-2.5-flare': 1,
      // audio: speech is 3 credits per 1,000 chars; effects 1 credit (≤30 s, 10 s assumed); voice changer 2 per minute
      'eleven-tts': 3, 'eleven-sfx': 1, 'eleven-sts': 2,
    };
    for (const [modelKey, cr] of Object.entries(credits)) {
      const rule = PROVIDER_COST_BOOK[modelKey]!;
      const cost = providerCostUsd({
        modelKey,
        durationSeconds: rule.kind === 'per_second' ? rule.defaultSeconds : rule.kind === 'seedance_tokens' ? 5 : undefined,
        inputVideoSeconds: rule.kind === 'upscale' ? 5 : undefined,
        textChars: rule.kind === 'per_1k_chars' ? 1000 : undefined,
      })!;
      const margin = (cr * 0.1 - cost.usd) / (cr * 0.1);
      expect(margin, `${modelKey}: ${cr} credits vs $${cost.usd}`).toBeGreaterThanOrEqual(0.33);
    }
  });
});

describe('failedCostFactor', () => {
  it('bills nothing for input rejections or before the provider ran', () => {
    expect(failedCostFactor({ provider: 'seedance', reachedProvider: true, reason: 'input_real_person' })).toBe(0);
    expect(failedCostFactor({ provider: 'gemini', reachedProvider: false })).toBe(0);
    expect(failedCostFactor({ provider: 'kling', reachedProvider: true, errorCode: 'r2_input_missing' })).toBe(0);
  });
  it('bills fal never, Google/OpenAI per call, Kling/BytePlus once the task ran', () => {
    expect(failedCostFactor({ provider: 'fal', reachedProvider: true })).toBe(0);
    expect(failedCostFactor({ provider: 'elevenlabs', reachedProvider: true })).toBe(0);
    expect(failedCostFactor({ provider: 'gemini', reachedProvider: true })).toBe(1);
    expect(failedCostFactor({ provider: 'openai', reachedProvider: true, reason: 'safety' })).toBe(1);
    expect(failedCostFactor({ provider: 'seedance', reachedProvider: true, reason: 'output_moderated' })).toBe(1);
  });
});
