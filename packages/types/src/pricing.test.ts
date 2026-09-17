/**
 * Credit pricing is money logic, so it is tested rather than trusted.
 *
 * The video-input cases are the expensive ones, and they are asserted
 * against BYTEPLUS'S OWN published examples rather than against our
 * arithmetic — including the case where their minimum charge binds
 * instead of their formula. Getting this dimension wrong is not visible
 * in the UI and not visible in a job's output; it shows up months later
 * as a margin that was never there.
 *
 * The catalogue numbers below come from `packages/db/pricing`: every
 * model priced at 1.5x its provider cost with one credit worth $0.10.
 */

import { describe, expect, it } from 'vitest';

import { resolveCreditCost } from './pricing';

/** One credit, in dollars. Lets a test say what a charge is really worth. */
const CREDIT_USD = 0.1;
const dollars = (credits: number) => credits * CREDIT_USD;

describe('images and flat-priced models', () => {
  it('charges the base price when no tier is selected', () => {
    expect(resolveCreditCost({ baseCredits: 3 })).toBe(3);
  });

  it('prefers the selected tier over the base price', () => {
    const nanoBananaPro = { baseCredits: 3, tierPricing: { '1K': 3, '2K': 3, '4K': 4 } };
    expect(resolveCreditCost({ ...nanoBananaPro, mode: '4K' })).toBe(4);
    expect(resolveCreditCost({ ...nanoBananaPro, mode: '1K' })).toBe(3);
  });

  it('falls back to the base price for a tier the catalogue does not list', () => {
    expect(resolveCreditCost({ baseCredits: 3, tierPricing: { '1K': 3 }, mode: '8K' })).toBe(3);
  });

  it('returns 0 for an unpriced model, so the caller can refuse the job', () => {
    expect(resolveCreditCost({ baseCredits: 0 })).toBe(0);
  });
});

describe('duration', () => {
  // Kling 3 at 1080p: 9 credits for the default 5 seconds.
  const kling3 = { baseCredits: 9, tierPricing: { std: 7, pro: 9 }, mode: 'pro', defaultDuration: 5 };

  it('scales linearly from the price\'s reference length', () => {
    expect(resolveCreditCost({ ...kling3, duration: 10 })).toBe(18);
    expect(resolveCreditCost({ ...kling3, duration: 15 })).toBe(27);
  });

  it('rounds up, so a fraction of a credit never leaks', () => {
    expect(resolveCreditCost({ ...kling3, duration: 6 })).toBe(11); // 10.8
  });

  it('skips scaling entirely when the model has no reference length', () => {
    expect(resolveCreditCost({ ...kling3, defaultDuration: undefined, duration: 10 })).toBe(9);
  });
});

describe('native audio', () => {
  // Kling 2.6: audio exists at 1080p only, and costs more per second.
  const kling26 = {
    baseCredits: 4,
    tierPricing: { std: 4, pro: 6, pro_audio: 11 },
    defaultDuration: 5,
  };

  it('charges the audio rate when sound will actually be served', () => {
    expect(resolveCreditCost({ ...kling26, mode: 'pro', sound: true })).toBe(11);
  });

  it('charges the silent rate on a tier with no audio price', () => {
    // 720p has no `std_audio` key: absence means "no surcharge", not "free".
    expect(resolveCreditCost({ ...kling26, mode: 'std', sound: true })).toBe(4);
  });
});

describe('Kling video input — a flat rate swap', () => {
  // Kling O1: 0.084 -> 0.126 $/s at 720p. The input clip's LENGTH does
  // not enter Kling's bill at all, so neither does it enter ours.
  const o1 = {
    baseCredits: 7,
    tierPricing: { std: 7, pro: 9, std_videoin: 10, pro_videoin: 13 },
    mode: 'std',
    defaultDuration: 5,
  };

  it('swaps to the video-in rate', () => {
    expect(resolveCreditCost({ ...o1, inputVideoSeconds: 4 })).toBe(10);
  });

  it('ignores how long the input clip is', () => {
    expect(resolveCreditCost({ ...o1, inputVideoSeconds: 4 })).toBe(
      resolveCreditCost({ ...o1, inputVideoSeconds: 30 }),
    );
  });

  it('takes precedence over audio, which Kling forbids alongside video', () => {
    expect(resolveCreditCost({ ...o1, sound: true, inputVideoSeconds: 4 })).toBe(10);
  });
});

describe('Seedance video input — billed over input PLUS output seconds', () => {
  // Seedance 2.5 at 1080p. 43 credits per 5s silent; the video-in key is
  // 26, carrying the ~0.6x rate BytePlus charges when a clip is attached.
  const seedance25_1080p = {
    baseCredits: 18,
    tierPricing: { '720p': 18, '1080p': 43, '720p_videoin': 11, '1080p_videoin': 26 },
    mode: '1080p',
    defaultDuration: 5,
    inputVideoFactor: 1.0,
  };

  /**
   * Each case is a row from BytePlus's published pricing examples. The
   * assertion is the MARKUP rather than a credit count, because that is
   * the property the catalogue promises: whatever the lengths, the charge
   * lands at roughly 1.5x what the provider bills us.
   */
  const published = [
    { input: 30, output: 5, providerUsd: 11.907 },
    { input: 4, output: 15, providerUsd: 8.505 }, // their MINIMUM binds here
    { input: 15, output: 15, providerUsd: 10.206 },
    { input: 30, output: 30, providerUsd: 20.412 },
  ];

  for (const { input, output, providerUsd } of published) {
    it(`earns ~1.5x on a ${input}s source with a ${output}s output`, () => {
      const credits = resolveCreditCost({
        ...seedance25_1080p,
        duration: output,
        inputVideoSeconds: input,
      });
      const markup = dollars(credits) / providerUsd;
      expect(markup).toBeGreaterThan(1.45);
      expect(markup).toBeLessThan(1.62);
    });
  }

  it('applies the published minimum when the source is short', () => {
    // A 15s output from a 4s source bills as 15 + ceil(15 x 2/3) = 25
    // seconds, not 19. Without the floor this would be 26 x (19/5) = 99.
    expect(
      resolveCreditCost({ ...seedance25_1080p, duration: 15, inputVideoSeconds: 4 }),
    ).toBe(130);
  });

  it('uses the real input length once it exceeds the minimum', () => {
    // 30 + 5 = 35 seconds, well above the 5 + 4 floor.
    expect(
      resolveCreditCost({ ...seedance25_1080p, duration: 5, inputVideoSeconds: 30 }),
    ).toBe(182);
  });

  it('costs more with a source attached than without one', () => {
    // The cheaper rate must never make an edit undercut a plain generation
    // of the same length — the input seconds are what pay for it.
    const withVideo = resolveCreditCost({
      ...seedance25_1080p,
      duration: 10,
      inputVideoSeconds: 10,
    });
    const silent = resolveCreditCost({ ...seedance25_1080p, duration: 10 });
    expect(withVideo).toBeGreaterThan(silent);
  });

  it('charges nothing extra for a model with no factor and no video-in keys', () => {
    expect(
      resolveCreditCost({
        baseCredits: 18,
        tierPricing: { '1080p': 43 },
        mode: '1080p',
        defaultDuration: 5,
        duration: 5,
        inputVideoSeconds: 30,
      }),
    ).toBe(43);
  });
});
