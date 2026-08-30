/**
 * Tests for the shared credit-cost resolver.
 *
 * It lives in `@clickfy/types` (the only package all four apps share)
 * but is exercised here, where the vitest harness already runs. Four
 * call sites depend on this arithmetic agreeing exactly — the job-create
 * route, template costing, the web composer and the mobile create
 * screen — so the cases below pin the behaviour each of them relies on.
 */

import { describe, expect, it } from 'vitest';
import { resolveCreditCost } from '@clickfy/types';

describe('resolveCreditCost', () => {
  it('uses the base price when the model has no tiers', () => {
    expect(resolveCreditCost({ baseCredits: 40 })).toBe(40);
  });

  it('prefers the selected tier over the base price', () => {
    const tierPricing = { std: 126, pro: 168, '4k': 630 };
    expect(resolveCreditCost({ baseCredits: 168, tierPricing, mode: 'std' })).toBe(126);
    expect(resolveCreditCost({ baseCredits: 168, tierPricing, mode: '4k' })).toBe(630);
  });

  it('falls back to base for a tier key the model does not price', () => {
    expect(
      resolveCreditCost({ baseCredits: 168, tierPricing: { std: 126 }, mode: 'ultra' }),
    ).toBe(168);
  });

  // The bug this module exists for: the UI showed the tier price and the
  // server charged the tier price scaled by duration.
  it('scales linearly with duration from the model default', () => {
    const kling3at1080p = {
      baseCredits: 168,
      tierPricing: { std: 126, pro: 168, '4k': 630 },
      mode: 'pro',
      defaultDuration: 5,
    };
    expect(resolveCreditCost({ ...kling3at1080p, duration: 5 })).toBe(168);
    expect(resolveCreditCost({ ...kling3at1080p, duration: 10 })).toBe(336);
    expect(resolveCreditCost({ ...kling3at1080p, duration: 15 })).toBe(504);
  });

  it('rounds a fractional credit up, never down', () => {
    // 126 * (7/5) = 176.4 — charging 176 would leak 0.4cr per job.
    expect(
      resolveCreditCost({ baseCredits: 126, duration: 7, defaultDuration: 5 }),
    ).toBe(177);
  });

  it('combines tier and duration, not one or the other', () => {
    // 4K for 10s: the tier is 5x the 720p price AND the clip is 2x long.
    expect(
      resolveCreditCost({
        baseCredits: 168,
        tierPricing: { std: 126, '4k': 630 },
        mode: '4k',
        duration: 10,
        defaultDuration: 5,
      }),
    ).toBe(1260);
  });

  it('skips duration scaling when the reference length is unknown', () => {
    // Image models, and any model missing `duration.default`. Guessing a
    // reference would silently mis-price every job on that model.
    expect(resolveCreditCost({ baseCredits: 40, duration: 10 })).toBe(40);
    expect(
      resolveCreditCost({ baseCredits: 40, duration: 10, defaultDuration: 0 }),
    ).toBe(40);
  });

  it('treats a missing or zero duration as the default length', () => {
    expect(resolveCreditCost({ baseCredits: 168, defaultDuration: 5 })).toBe(168);
    expect(
      resolveCreditCost({ baseCredits: 168, duration: 0, defaultDuration: 5 }),
    ).toBe(168);
  });

  it('returns 0 for an unpriced model rather than inventing a price', () => {
    // Callers refuse the job on 0; scaling it would still be 0, but the
    // early return keeps that explicit.
    expect(resolveCreditCost({ baseCredits: 0, duration: 10, defaultDuration: 5 })).toBe(0);
  });

  // Native audio: Kling bills sound-on generation at a higher per-second
  // rate, carried as `${tier}_audio` keys in the same tier_pricing JSONB.
  describe('native-audio pricing', () => {
    // Kling 2.6: silent 63/105, audio only exists at pro (1.0 U/s → 210).
    const kling26 = {
      baseCredits: 63,
      tierPricing: { std: 63, pro: 105, pro_audio: 210 },
      defaultDuration: 5,
    };

    it('charges the audio tier price when sound is on', () => {
      expect(resolveCreditCost({ ...kling26, mode: 'pro', sound: true })).toBe(210);
    });

    it('still charges the silent price when sound is off', () => {
      expect(resolveCreditCost({ ...kling26, mode: 'pro', sound: false })).toBe(105);
      expect(resolveCreditCost({ ...kling26, mode: 'pro' })).toBe(105);
    });

    it('falls back to the silent tier when no audio key is priced', () => {
      // Tiers where audio costs the same (Kling 4k) or providers that
      // bake audio into the base rate (Seedance) simply omit the key.
      expect(resolveCreditCost({ ...kling26, mode: 'std', sound: true })).toBe(63);
    });

    it('scales the audio price by duration like any other tier', () => {
      expect(
        resolveCreditCost({ ...kling26, mode: 'pro', sound: true, duration: 10 }),
      ).toBe(420);
    });

    it('ignores sound when no tier is selected', () => {
      // Without a mode there is no audio key to look up — base price wins.
      expect(resolveCreditCost({ baseCredits: 63, sound: true })).toBe(63);
    });
  });

  // Input video: Kling swaps to `${tier}_videoin` rate keys (flat 1.5x,
  // length-independent); Seedance bills the input's duration as extra
  // effective output-seconds via `inputVideoFactor`.
  describe('input-video pricing', () => {
    // Kling 3 Omni at prod's 2x markup: silent 84/112, video-in x1.5.
    const klingOmni = {
      baseCredits: 112,
      tierPricing: {
        std: 84,
        pro: 112,
        '4k': 420,
        std_audio: 112,
        pro_audio: 140,
        std_videoin: 126,
        pro_videoin: 168,
      },
      defaultDuration: 5,
    };

    it('swaps to the video-in tier rate when an input video is present', () => {
      expect(
        resolveCreditCost({ ...klingOmni, mode: 'pro', inputVideoSeconds: 8 }),
      ).toBe(168);
      // Length-independent on Kling — 3s of input costs the same rate.
      expect(
        resolveCreditCost({ ...klingOmni, mode: 'pro', inputVideoSeconds: 3 }),
      ).toBe(168);
    });

    it('video-in wins over audio (Kling forbids native audio with video input)', () => {
      expect(
        resolveCreditCost({ ...klingOmni, mode: 'pro', sound: true, inputVideoSeconds: 5 }),
      ).toBe(168);
    });

    it('falls back to the silent tier when no videoin key is priced (4k)', () => {
      expect(
        resolveCreditCost({ ...klingOmni, mode: '4k', inputVideoSeconds: 5 }),
      ).toBe(420);
    });

    it('still scales the video-in rate by output duration', () => {
      expect(
        resolveCreditCost({ ...klingOmni, mode: 'pro', inputVideoSeconds: 5, duration: 10 }),
      ).toBe(336);
    });

    it('bills Seedance input video as extra effective seconds', () => {
      // Seedance 2.5 @720p (347cr for 5s), 10s of reference video at
      // factor 0.6 → 6 extra seconds → 347 * (5+6)/5 = 763.4 → 764.
      expect(
        resolveCreditCost({
          baseCredits: 347,
          tierPricing: { '480p': 154, '720p': 347, '1080p': 853 },
          mode: '720p',
          duration: 5,
          defaultDuration: 5,
          inputVideoSeconds: 10,
          inputVideoFactor: 0.6,
        }),
      ).toBe(764);
    });

    it('charges nothing extra without a factor or a videoin key', () => {
      // A model that prices video input some other way (or not at all)
      // is inert — the dimension is opt-in per model.
      expect(
        resolveCreditCost({
          baseCredits: 347,
          tierPricing: { '720p': 347 },
          mode: '720p',
          duration: 5,
          defaultDuration: 5,
          inputVideoSeconds: 10,
        }),
      ).toBe(347);
    });

    it('ignores the factor when duration scaling is inactive (image models)', () => {
      expect(
        resolveCreditCost({ baseCredits: 40, inputVideoSeconds: 10, inputVideoFactor: 0.6 }),
      ).toBe(40);
    });

    it('treats zero/absent input seconds as no video', () => {
      expect(
        resolveCreditCost({ ...klingOmni, mode: 'pro', inputVideoSeconds: 0 }),
      ).toBe(112);
      expect(resolveCreditCost({ ...klingOmni, mode: 'pro' })).toBe(112);
    });
  });
});
