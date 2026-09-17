/**
 * The tier ladder decides whether a plan change is an upgrade or a
 * downgrade, and that decision drives both what the pricing page offers
 * and whether Stripe prorates immediately or waits for the period end.
 * Getting it backwards charges someone immediately for a downgrade.
 */

import { describe, expect, it } from 'vitest';

import { ASSIGNABLE_ENTITLEMENTS, PAID_TIERS, planDirection, tierRank } from './user';

describe('tierRank', () => {
  it('ranks the paid tiers in ladder order', () => {
    const ranks = PAID_TIERS.map(tierRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(PAID_TIERS.length);
  });

  it('puts free at the bottom and admin at the top', () => {
    expect(tierRank('free')).toBe(0);
    expect(tierRank('admin')).toBeGreaterThan(tierRank('ultimate'));
  });

  it('ranks the retired pro_max with the tier that replaced it', () => {
    // A legacy row must compare as Ultimate, not fall off the bottom and
    // read as an upgrade to everything.
    expect(tierRank('pro_max')).toBe(tierRank('ultimate'));
  });
});

describe('planDirection', () => {
  it('reads up the ladder as an upgrade', () => {
    expect(planDirection('basic', 'creator')).toBe('upgrade');
    expect(planDirection('free', 'basic')).toBe('upgrade');
  });

  it('reads down the ladder as a downgrade', () => {
    expect(planDirection('ultimate', 'pro')).toBe('downgrade');
  });

  it('reads the same tier as current, whatever the interval', () => {
    expect(planDirection('pro', 'pro')).toBe('current');
  });
});

describe('ASSIGNABLE_ENTITLEMENTS', () => {
  it('offers every paid tier plus free', () => {
    expect(ASSIGNABLE_ENTITLEMENTS).toEqual(['free', 'basic', 'creator', 'pro', 'ultimate']);
  });

  it('never offers the retired tier or the admin role', () => {
    // The whole reason this constant exists: three admin screens had
    // drifted to a list that could not grant Basic, Creator or Ultimate.
    expect(ASSIGNABLE_ENTITLEMENTS).not.toContain('pro_max');
    expect(ASSIGNABLE_ENTITLEMENTS).not.toContain('admin');
  });
});
