/**
 * The plan-change policy is money logic, so it is tested rather than
 * trusted. The fixtures are REAL invoice shapes — the two-line proration
 * invoice is the one that mis-granted a paying customer on 2026-09-23,
 * and the others were captured from a sandbox test clock the next day.
 */

import { describe, expect, it } from 'vitest';

import {
  decideRollover,
  isSelfServePlanChange,
  resolveInvoicePriceId,
  resolvePeriodEnd,
  subscriptionLotExpiry,
} from './plan-change-policy';

const CREATOR = 'price_creator';
const ULTIMATE = 'price_ultimate';

/** Huda's upgrade invoice: the negative old-plan line comes FIRST. */
const prorationInvoice = [
  { amount: -3767, priceId: CREATOR, periodEnd: 1_792_656_643 },
  { amount: 9562, priceId: ULTIMATE, periodEnd: 1_792_656_643 },
];

describe('decideRollover', () => {
  it('carries unspent credits on an upgrade', () => {
    expect(decideRollover('creator', 'ultimate')).toBe('carry');
    expect(decideRollover('basic', 'creator')).toBe('carry');
  });
  it('wipes on a renewal of the same tier', () => {
    expect(decideRollover('creator', 'creator')).toBe('wipe');
  });
  it('wipes when a downgrade lands', () => {
    expect(decideRollover('ultimate', 'creator')).toBe('wipe');
  });
  it('wipes when there is no previous grant to compare with', () => {
    expect(decideRollover(null, 'creator')).toBe('wipe');
    expect(decideRollover('free', 'creator')).toBe('carry');
  });
});

describe('resolveInvoicePriceId', () => {
  it('prefers the subscription price when known', () => {
    expect(resolveInvoicePriceId(prorationInvoice, ULTIMATE)).toBe(ULTIMATE);
  });
  it('never picks the negative first line of a proration invoice', () => {
    expect(resolveInvoicePriceId(prorationInvoice, null)).toBe(ULTIMATE);
  });
  it('picks the only line of an ordinary invoice', () => {
    expect(resolveInvoicePriceId([{ amount: 3900, priceId: CREATOR, periodEnd: 1 }], null)).toBe(
      CREATOR,
    );
  });
  it('picks the full-period line, not a small proration line, on a renewal', () => {
    // Captured from a sandbox renewal after an anchor reset: a five-day
    // "remaining time" line precedes the real period line.
    const renewal = [
      { amount: 306, priceId: CREATOR, periodEnd: 10 },
      { amount: 3900, priceId: CREATOR, periodEnd: 20 },
    ];
    expect(resolveInvoicePriceId(renewal, null)).toBe(CREATOR);
    // The renewal date is the END of the real period, not of the stub.
    expect(resolvePeriodEnd(renewal, CREATOR)).toBe(20);
  });
  it('returns null when nothing is positive', () => {
    expect(resolveInvoicePriceId([{ amount: -100, priceId: CREATOR, periodEnd: 1 }], null)).toBe(
      null,
    );
    expect(resolveInvoicePriceId([], null)).toBe(null);
  });
});

describe('resolvePeriodEnd', () => {
  it('reads the period from the resolved price line', () => {
    expect(resolvePeriodEnd(prorationInvoice, ULTIMATE)).toBe(1_792_656_643);
  });
  it('falls back to any line with a period', () => {
    expect(resolvePeriodEnd(prorationInvoice, 'price_other')).toBe(1_792_656_643);
    expect(resolvePeriodEnd([], CREATOR)).toBe(null);
  });
});

describe('subscriptionLotExpiry', () => {
  const now = new Date('2026-10-01T09:00:00Z');
  it('expires a monthly lot at the real period end, even in a 31-day month', () => {
    const periodEnd = new Date('2026-11-01T09:00:00Z');
    expect(subscriptionLotExpiry('month', periodEnd, now)).toEqual(periodEnd);
  });
  it('gives a yearly lot 30 days regardless of the period end', () => {
    const periodEnd = new Date('2027-10-01T09:00:00Z');
    expect(subscriptionLotExpiry('year', periodEnd, now)).toEqual(
      new Date('2026-10-31T09:00:00Z'),
    );
  });
  it('falls back to 30 days when the period end is missing or in the past', () => {
    expect(subscriptionLotExpiry('month', null, now)).toEqual(new Date('2026-10-31T09:00:00Z'));
    expect(subscriptionLotExpiry('month', new Date('2026-09-01T00:00:00Z'), now)).toEqual(
      new Date('2026-10-31T09:00:00Z'),
    );
  });
});

describe('isSelfServePlanChange', () => {
  it('allows only monthly to monthly', () => {
    expect(isSelfServePlanChange('month', 'month')).toBe(true);
    expect(isSelfServePlanChange('month', 'year')).toBe(false);
    expect(isSelfServePlanChange('year', 'month')).toBe(false);
    expect(isSelfServePlanChange('year', 'year')).toBe(false);
    expect(isSelfServePlanChange(null, 'month')).toBe(false);
  });
});
