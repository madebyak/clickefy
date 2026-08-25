/**
 * How much media library storage each plan gets.
 *
 * Lives in `@clickfy/types` for the reason `pricing.ts` and
 * `refund-policy.ts` do: the API enforces the limit and the UI draws the
 * progress bar, and a number that appears in both places must come from
 * one of them. A UI saying "3 of 25 GB" while the API refuses at 20 is the
 * kind of disagreement nobody reports as a bug, they just stop trusting it.
 *
 * ── THE ECONOMICS ────────────────────────────────────────────────────
 * R2 is $0.015 per GB-month with NO egress fees, which is what makes a
 * media library affordable at all — the same library on S3 would bill for
 * every reference fetched into every generation.
 *
 *   plan       quota    cost/mo at 100%    revenue   share
 *   ────────────────────────────────────────────────────────
 *   free         5 GB        $0.07            —        —
 *   basic       25 GB        $0.38          $19       2.0%
 *   creator    100 GB        $1.50          $39       3.8%
 *   pro        250 GB        $3.75          $75       5.0%
 *   ultimate   500 GB        $7.50          $99       7.6%
 *
 * Those are FLOOR figures — the cost if every customer fills their quota
 * to the byte, which nobody does. The real exposure is the free tier,
 * which has no revenue behind it: ten thousand free users each filling
 * 5 GB is 50 TB and $750 a month. Worth watching if free signups scale
 * faster than conversions.
 */

/** Plan tiers that can hold library storage. Mirrors `users.entitlement`. */
export type StorageTier =
  | 'free'
  | 'basic'
  | 'creator'
  | 'pro'
  | 'ultimate'
  | 'pro_max'
  | 'admin';

const GB = 1024 * 1024 * 1024;

/**
 * Quota in BYTES, keyed by entitlement.
 *
 * `pro_max` is the retired tier (migration 0030) mapped to its successor,
 * and `admin` gets the top allowance — an admin account hitting a storage
 * wall while investigating a support ticket helps nobody.
 */
export const STORAGE_QUOTA_BYTES: Record<StorageTier, number> = {
  free: 5 * GB,
  basic: 25 * GB,
  creator: 100 * GB,
  pro: 250 * GB,
  ultimate: 500 * GB,
  pro_max: 500 * GB,
  admin: 500 * GB,
};

/** Quota for an entitlement, falling back to the free allowance. */
export function storageQuotaFor(entitlement: string): number {
  return STORAGE_QUOTA_BYTES[entitlement as StorageTier] ?? STORAGE_QUOTA_BYTES.free;
}

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number;
  /** 0–1. Clamped, so a legacy over-quota account cannot render past 100%. */
  fraction: number;
  remainingBytes: number;
}

export function describeUsage(usedBytes: number, quotaBytes: number): StorageUsage {
  const used = Math.max(0, usedBytes);
  return {
    usedBytes: used,
    quotaBytes,
    fraction: quotaBytes > 0 ? Math.min(1, used / quotaBytes) : 1,
    // Never negative: an account that somehow exceeded its quota should
    // read as "0 left", not as a negative allowance.
    remainingBytes: Math.max(0, quotaBytes - used),
  };
}

/**
 * Would this upload fit?
 *
 * Checked BEFORE the bytes are sent, so someone on a slow connection is
 * told at once rather than after a three-minute upload.
 */
export function fitsInQuota(
  usedBytes: number,
  quotaBytes: number,
  incomingBytes: number,
): boolean {
  return usedBytes + incomingBytes <= quotaBytes;
}

/** "1.4 GB", "812 MB", "0 B" — for labels, not for arithmetic. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  // Whole numbers below GB; one decimal above, where the difference
  // between 1.2 and 1.9 GB is worth seeing.
  return `${i >= 3 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
