/**
 * Refund credits to a user after an infra-class job failure.
 *
 * Bucket-aware: the original `job_charge` ledger rows record which
 * bucket(s) were debited. A refund reverses each of those into the
 * SAME bucket so the user's bucket-level invariants survive a failed
 * generation. (E.g. a job that ate 5 promo + 15 subscription credits
 * gets exactly +5 promo and +15 subscription returned — not a flat 20
 * dropped into one bucket.)
 *
 * Idempotency: a refund is keyed by `(job_id, reason='refund')`. The
 * `NOT EXISTS` predicate short-circuits the whole chain, so even a
 * double-call to `failJob()` results in a single set of refund rows.
 *
 * We refund only when the failure is not the user's fault — bad inputs
 * or unknown_model stay debited because they indicate something the
 * user must change.
 */

import { sql } from 'drizzle-orm';

import { logger } from '@trigger.dev/sdk';

import type { JobError } from '@clickfy/db';

import { getDb } from './db';

const REFUNDABLE_CODES: ReadonlySet<JobError['code']> = new Set([
  'provider_error',
  'provider_timeout',
  'r2_input_missing',
  'internal_error',
]);

export function isRefundable(code: JobError['code']): boolean {
  return REFUNDABLE_CODES.has(code);
}

export async function refundForJob(jobId: string): Promise<number> {
  const db = getDb();

  // Single atomic CTE chain:
  //   1. not_yet    — guard: no refund row exists for this job
  //   2. charges    — the job_charge rows that originally debited
  //                   (bucket may be NULL on legacy rows from before
  //                   migration 0010; coalesce to 'promo' which is the
  //                   safest bucket to credit into — spendable always,
  //                   never expires)
  //   3. totals     — per-bucket sums
  //   4. user_credit — UPDATE users adding totals back to each bucket
  //   5. ledger     — INSERT up to 3 refund rows, one per bucket > 0
  //
  // Final SELECT returns one row per inserted ledger row; we count
  // them in JS to distinguish "applied N rows" from "already refunded".
  const result = await db.execute<{ ledger_id: string }>(sql`
    WITH
      not_yet AS (
        SELECT 1 AS ok
        WHERE NOT EXISTS (
          SELECT 1 FROM credit_ledger
          WHERE job_id = ${jobId}::uuid AND reason = 'refund'
        )
      ),
      charges AS (
        SELECT
          user_id,
          COALESCE(bucket, 'promo') AS bucket,
          -delta AS refund_amount
        FROM credit_ledger
        WHERE job_id = ${jobId}::uuid AND reason = 'job_charge'
      ),
      totals AS (
        SELECT
          MAX(user_id) AS user_id,
          COALESCE(SUM(CASE WHEN bucket = 'promo'        THEN refund_amount END), 0)::int AS r_promo,
          COALESCE(SUM(CASE WHEN bucket = 'subscription' THEN refund_amount END), 0)::int AS r_sub,
          COALESCE(SUM(CASE WHEN bucket = 'topup'        THEN refund_amount END), 0)::int AS r_topup,
          COALESCE(SUM(refund_amount), 0)::int AS r_total
        FROM charges
      ),
      user_credit AS (
        UPDATE users u
        SET
          promo_credits        = u.promo_credits        + totals.r_promo,
          subscription_credits = u.subscription_credits + totals.r_sub,
          topup_credits        = u.topup_credits        + totals.r_topup,
          credits_balance      = u.credits_balance      + totals.r_total
        FROM totals
        WHERE u.id = totals.user_id
          AND EXISTS (SELECT 1 FROM not_yet)
          AND totals.r_total > 0
        RETURNING
          u.credits_balance AS new_balance,
          totals.user_id    AS user_id,
          totals.r_promo,
          totals.r_sub,
          totals.r_topup
      ),
      ledger AS (
        INSERT INTO credit_ledger (
          user_id, delta, reason, job_id, balance_after, bucket, metadata
        )
        SELECT uc.user_id, uc.r_promo, 'refund', ${jobId}::uuid,
               uc.new_balance, 'promo',
               jsonb_build_object('rPromo', uc.r_promo, 'rSub', uc.r_sub, 'rTopup', uc.r_topup)
        FROM user_credit uc WHERE uc.r_promo > 0
        UNION ALL
        SELECT uc.user_id, uc.r_sub, 'refund', ${jobId}::uuid,
               uc.new_balance, 'subscription',
               jsonb_build_object('rPromo', uc.r_promo, 'rSub', uc.r_sub, 'rTopup', uc.r_topup)
        FROM user_credit uc WHERE uc.r_sub > 0
        UNION ALL
        SELECT uc.user_id, uc.r_topup, 'refund', ${jobId}::uuid,
               uc.new_balance, 'topup',
               jsonb_build_object('rPromo', uc.r_promo, 'rSub', uc.r_sub, 'rTopup', uc.r_topup)
        FROM user_credit uc WHERE uc.r_topup > 0
        RETURNING id AS ledger_id
      )
    SELECT ledger_id FROM ledger
  `);

  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  if (rows.length === 0) {
    logger.info('refund:skipped-or-already-applied', { jobId });
    return 0;
  }
  logger.info('refund:applied', { jobId, ledgerRows: rows.length });
  return rows.length;
}
