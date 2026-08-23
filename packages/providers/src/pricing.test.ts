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
});
