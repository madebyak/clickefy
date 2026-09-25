/**
 * Shapes taken from live Stripe objects on 2026-09-24/25, not invented:
 * the portal cancellation of sub_1UImBr… (`cancel_at` set, flag false)
 * and our own route's cancellation from the sandbox E2E (flag true).
 */

import { describe, expect, it } from 'vitest';

import { cancellationTransition, subscriptionEndsAt } from './subscription-state';

const PERIOD_END = 1792746608; // 2026-10-23T09:10:08Z

describe('subscriptionEndsAt', () => {
  it('reads a portal cancellation (cancel_at set, flag false)', () => {
    expect(
      subscriptionEndsAt({ cancelAt: PERIOD_END, cancelAtPeriodEnd: false, periodEnd: PERIOD_END }),
    ).toEqual(new Date('2026-10-23T09:10:08.000Z'));
  });
  it('reads our own cancellation (flag true, cancel_at null)', () => {
    expect(
      subscriptionEndsAt({ cancelAt: null, cancelAtPeriodEnd: true, periodEnd: PERIOD_END }),
    ).toEqual(new Date('2026-10-23T09:10:08.000Z'));
  });
  it('prefers the explicit date when both are present', () => {
    expect(
      subscriptionEndsAt({ cancelAt: PERIOD_END + 60, cancelAtPeriodEnd: true, periodEnd: PERIOD_END }),
    ).toEqual(new Date((PERIOD_END + 60) * 1000));
  });
  it('is null for a plan that continues', () => {
    expect(subscriptionEndsAt({ cancelAt: null, cancelAtPeriodEnd: false, periodEnd: PERIOD_END })).toBe(null);
    expect(subscriptionEndsAt({ cancelAt: undefined, cancelAtPeriodEnd: undefined, periodEnd: undefined })).toBe(null);
  });
  it('cannot invent a date from the flag alone', () => {
    expect(subscriptionEndsAt({ cancelAt: null, cancelAtPeriodEnd: true, periodEnd: null })).toBe(null);
  });
});

describe('cancellationTransition', () => {
  const ends = new Date(PERIOD_END * 1000);

  it('recognises the portal cancellation event (previous cancel_at null → set)', () => {
    // Exactly `evt_1UJ8bPQvmIgrJttKHA05eK5I`'s previous_attributes.
    const prev = {
      cancel_at: null,
      canceled_at: null,
      cancellation_details: { reason: null },
      trial_settings: { end_behavior: { billing_cycle_anchor: null } },
    };
    expect(cancellationTransition(prev, ends)).toBe('scheduled');
  });
  it('recognises our own cancellation (previous flag false → true)', () => {
    expect(cancellationTransition({ cancel_at_period_end: false }, ends)).toBe('scheduled');
  });
  it('recognises a resume from either spelling', () => {
    expect(cancellationTransition({ cancel_at: PERIOD_END }, null)).toBe('undone');
    expect(cancellationTransition({ cancel_at_period_end: true }, null)).toBe('undone');
  });
  it('ignores the follow-up event that only records the survey answer', () => {
    // `evt_1UJ8bQQvmIgrJttK2IpUejA3`: cancellation_details.feedback only.
    expect(cancellationTransition({ cancellation_details: { feedback: null } }, ends)).toBe(null);
  });
  it('ignores events that touch neither field, and date-only moves', () => {
    expect(cancellationTransition({ metadata: {} }, null)).toBe(null);
    expect(cancellationTransition(undefined, ends)).toBe(null);
    expect(cancellationTransition({ cancel_at: PERIOD_END - 100 }, ends)).toBe(null);
  });
});
