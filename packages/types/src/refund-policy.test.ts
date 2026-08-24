/**
 * The refund policy is money logic, so it is tested rather than trusted.
 *
 * Each case below is a real scenario someone will eventually hit, and the
 * expensive ones are the refusals: an eligible refund costs us one
 * month's fee, while a wrongly-approved one costs the fee PLUS whatever
 * provider bills the customer already ran up. The boundary tests exist
 * because "7 days" is exactly the kind of rule that ships off-by-one.
 */

import { describe, expect, it } from 'vitest';

import { SUBSCRIPTION_REFUND_WINDOW_DAYS, evaluateSubscriptionRefund } from './refund-policy';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-24T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

/** An untouched period granted `n` days ago. */
const untouched = (granted: number, n: number) => ({
  amountGranted: granted,
  amountRemaining: granted,
  createdAt: daysAgo(n),
});

describe('subscription refunds', () => {
  it('allows a same-day refund of an untouched period', () => {
    const v = evaluateSubscriptionRefund(untouched(4_500, 0), NOW);
    expect(v.eligible).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.creditsUsed).toBe(0);
  });

  it('refuses once a SINGLE credit has been spent', () => {
    // The rule that matters most. One image generated is real money spent
    // with a provider, and no refund can un-render it.
    const v = evaluateSubscriptionRefund(
      { amountGranted: 4_500, amountRemaining: 4_499, createdAt: daysAgo(1) },
      NOW,
    );
    expect(v.eligible).toBe(false);
    expect(v.reasons).toContain('credits_used');
    expect(v.creditsUsed).toBe(1);
  });

  it('refuses a fully-spent period even on day one', () => {
    const v = evaluateSubscriptionRefund(
      { amountGranted: 12_500, amountRemaining: 0, createdAt: daysAgo(0) },
      NOW,
    );
    expect(v.eligible).toBe(false);
    expect(v.reasons).toContain('credits_used');
    expect(v.creditsUsed).toBe(12_500);
  });

  it('allows refunds up to and including the window boundary', () => {
    // Day 7 is inside the window; day 8 is not. Stated explicitly because
    // this is where an off-by-one would quietly live.
    expect(evaluateSubscriptionRefund(untouched(2_000, SUBSCRIPTION_REFUND_WINDOW_DAYS), NOW).eligible).toBe(true);
  });

  it('refuses the day after the window closes', () => {
    const v = evaluateSubscriptionRefund(untouched(2_000, SUBSCRIPTION_REFUND_WINDOW_DAYS + 1), NOW);
    expect(v.eligible).toBe(false);
    expect(v.reasons).toContain('outside_window');
  });

  it('reports BOTH reasons when a period is old and spent', () => {
    // Support needs the whole story, not the first thing that failed.
    const v = evaluateSubscriptionRefund(
      { amountGranted: 9_000, amountRemaining: 100, createdAt: daysAgo(30) },
      NOW,
    );
    expect(v.eligible).toBe(false);
    expect(v.reasons).toEqual(expect.arrayContaining(['credits_used', 'outside_window']));
  });

  it('refuses when there is no subscription period at all', () => {
    const v = evaluateSubscriptionRefund(null, NOW);
    expect(v.eligible).toBe(false);
    expect(v.reasons).toContain('no_subscription_period');
  });

  it('never reports negative usage if remaining somehow exceeds granted', () => {
    // Defensive: a clamp bug upstream should not surface as "-50 spent".
    const v = evaluateSubscriptionRefund(
      { amountGranted: 100, amountRemaining: 150, createdAt: daysAgo(1) },
      NOW,
    );
    expect(v.creditsUsed).toBe(0);
    expect(v.eligible).toBe(true);
  });
});
