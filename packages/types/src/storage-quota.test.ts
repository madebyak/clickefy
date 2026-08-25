/**
 * Quota arithmetic decides whether an upload is accepted, so the edges are
 * tested: exactly at the limit, one byte over, and the states an account
 * can only reach by having been over-quota before a plan change.
 */

import { describe, expect, it } from 'vitest';

import {
  STORAGE_QUOTA_BYTES,
  describeUsage,
  fitsInQuota,
  formatBytes,
  storageQuotaFor,
} from './storage-quota';

const GB = 1024 ** 3;

describe('quota lookup', () => {
  it('gives every live tier an allowance', () => {
    for (const tier of ['free', 'basic', 'creator', 'pro', 'ultimate'] as const) {
      expect(storageQuotaFor(tier)).toBeGreaterThan(0);
    }
  });

  it('never decreases as the plan gets more expensive', () => {
    const ladder = ['free', 'basic', 'creator', 'pro', 'ultimate'] as const;
    for (let i = 1; i < ladder.length; i++) {
      expect(STORAGE_QUOTA_BYTES[ladder[i]!]).toBeGreaterThan(STORAGE_QUOTA_BYTES[ladder[i - 1]!]);
    }
  });

  it('falls back to free for an unknown entitlement', () => {
    // A tier added to the DB before this map knows about it must not
    // resolve to `undefined` and let an unlimited upload through.
    expect(storageQuotaFor('some_future_tier')).toBe(STORAGE_QUOTA_BYTES.free);
  });

  it('maps the retired pro_max tier to a real allowance', () => {
    expect(storageQuotaFor('pro_max')).toBe(STORAGE_QUOTA_BYTES.ultimate);
  });
});

describe('fitsInQuota', () => {
  it('accepts an upload that lands exactly on the limit', () => {
    expect(fitsInQuota(4 * GB, 5 * GB, 1 * GB)).toBe(true);
  });

  it('rejects one byte over', () => {
    expect(fitsInQuota(4 * GB, 5 * GB, 1 * GB + 1)).toBe(false);
  });

  it('rejects anything when already full', () => {
    expect(fitsInQuota(5 * GB, 5 * GB, 1)).toBe(false);
  });
});

describe('describeUsage', () => {
  it('reports a normal fraction', () => {
    const u = describeUsage(1 * GB, 4 * GB);
    expect(u.fraction).toBeCloseTo(0.25);
    expect(u.remainingBytes).toBe(3 * GB);
  });

  it('clamps an over-quota account to 100% and 0 remaining', () => {
    // Reachable by downgrading a plan, which must render as full rather
    // than as a bar past its own end and a negative allowance.
    const u = describeUsage(60 * GB, 25 * GB);
    expect(u.fraction).toBe(1);
    expect(u.remainingBytes).toBe(0);
  });

  it('treats a nonsensical negative usage as zero', () => {
    expect(describeUsage(-500, 5 * GB).usedBytes).toBe(0);
  });
});

describe('formatBytes', () => {
  it('formats across the scale', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(5 * 1024)).toBe('5 KB');
    expect(formatBytes(12 * 1024 ** 2)).toBe('12 MB');
    expect(formatBytes(1.5 * GB)).toBe('1.5 GB');
  });
});
