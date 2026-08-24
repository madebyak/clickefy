/**
 * The dunning deadline decides when someone stops being served, so the
 * boundary is tested from both sides. An hour early cuts off a paying
 * customer; a day late is a day of us paying model providers for someone
 * whose card declined.
 */

import { describe, expect, it } from 'vitest';

import {
  DUNNING_GRACE_HOURS,
  MAX_PAYMENT_ATTEMPTS,
  evaluateDunning,
  hasExhaustedAttempts,
} from './dunning-policy';

const NOW = new Date('2026-08-24T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const failingFor = (h: number) => ({ invoiceCreatedAt: hoursAgo(h), startedAt: null });

describe('dunning deadline', () => {
  it('keeps serving during the grace window', () => {
    const v = evaluateDunning(failingFor(1), NOW);
    expect(v.cancel).toBe(false);
    expect(v.reason).toBe('within_grace');
    expect(v.failingForHours).toBe(1);
  });

  it('still keeps serving one hour before the deadline', () => {
    expect(evaluateDunning(failingFor(DUNNING_GRACE_HOURS - 1), NOW).cancel).toBe(false);
  });

  it('cancels exactly AT the deadline', () => {
    // 24h means 24h. Requiring 25 would quietly grant an extra hour of
    // free service to every failing subscription.
    const v = evaluateDunning(failingFor(DUNNING_GRACE_HOURS), NOW);
    expect(v.cancel).toBe(true);
    expect(v.reason).toBe('past_deadline');
  });

  it('cancels well past the deadline', () => {
    const v = evaluateDunning(failingFor(72), NOW);
    expect(v.cancel).toBe(true);
    expect(v.failingForHours).toBe(72);
  });

  it('falls back to the start date when there is no invoice', () => {
    const v = evaluateDunning({ invoiceCreatedAt: null, startedAt: hoursAgo(48) }, NOW);
    expect(v.cancel).toBe(true);
  });

  it('WAITS rather than cancels when the age is unknowable', () => {
    // The safe direction. Cancelling a paying customer on missing data is
    // far worse than serving an unpaid one until the next hourly sweep.
    const v = evaluateDunning({ invoiceCreatedAt: null, startedAt: null }, NOW);
    expect(v.cancel).toBe(false);
    expect(v.reason).toBe('unknown_age');
  });

  it('never cancels on a clock skew that puts the invoice in the future', () => {
    const future = { invoiceCreatedAt: new Date(NOW.getTime() + 3600_000), startedAt: null };
    expect(evaluateDunning(future, NOW).cancel).toBe(false);
  });
});

describe('attempt limit', () => {
  it('waits below the limit', () => {
    expect(hasExhaustedAttempts(MAX_PAYMENT_ATTEMPTS - 1)).toBe(false);
  });
  it('fires at the limit', () => {
    expect(hasExhaustedAttempts(MAX_PAYMENT_ATTEMPTS)).toBe(true);
  });
  it('fires above the limit', () => {
    expect(hasExhaustedAttempts(MAX_PAYMENT_ATTEMPTS + 5)).toBe(true);
  });
});
