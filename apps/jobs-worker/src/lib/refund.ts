/**
 * Refund credits to a user after an infra-class job failure.
 *
 * Lot-aware: the original `job_charge` ledger rows record the exact
 * `credit_lots` row each credit came from, so a refund puts the credits
 * back where they were rather than dropping a flat total into one class.
 * That matters because lots carry expiry — returning a subscription credit
 * into a never-expiring promo lot would quietly hand out something the
 * user never had.
 *
 * Two destinations, decided per charge row:
 *
 *   1. The ORIGINAL lot, when it still exists, has not expired, and has
 *      room (`amount_remaining + amt <= amount_granted`). This is the
 *      normal path and preserves expiry exactly.
 *   2. A fresh `kind='refund'` lot with NO expiry, when the original is
 *      gone, expired, or already refilled. The user is not penalised for
 *      our failure — if their credit's original home expired while our
 *      job was broken, they get it back on terms that cannot expire
 *      underneath them again.
 *
 * Idempotency, belt and braces:
 *   - `not_yet` short-circuits the whole chain if any `reason='refund'`
 *     row already exists for the job.
 *   - `credit_ledger_refund_unique_idx` on `(job_id, bucket)` is the
 *     database-level backstop if two callers race past the guard.
 *   - Replacement lots use `source_ref = '<jobId>:<class>'` against the
 *     `(user_id, kind, source_ref)` unique index, so a racing retry
 *     cannot mint a second replacement lot either.
 *
 * We refund only when the failure is not the user's fault — bad inputs or
 * unknown_model stay debited because they indicate something the user
 * must change.
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
  try {
    return await runRefund(db, jobId);
  } catch (err) {
    // Unique-violation on either idempotency guard: a concurrent refund
    // (sweeper + failJob racing) won. The loser's whole statement rolled
    // back with the failed INSERT, so exactly one refund applied.
    const e = err as { code?: string; message?: string };
    if (e?.code === '23505' || /duplicate key value/i.test(e?.message ?? '')) {
      logger.info('refund:lost-concurrent-race (already refunded)', { jobId });
      return 0;
    }
    throw err;
  }
}

async function runRefund(db: ReturnType<typeof getDb>, jobId: string): Promise<number> {
  // One statement. Postgres runs the whole CTE chain as a single implicit
  // transaction, so either every lot, the projection and the ledger move
  // together, or nothing does.
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
          lot_id,
          -- bucket is the spend class. Legacy rows from before migration
          -- 0010 have none; promo is the safest home (always spendable,
          -- never expires).
          COALESCE(bucket, 'promo') AS class,
          -delta AS amt
        FROM credit_ledger
        WHERE job_id = ${jobId}::uuid
          AND reason = 'job_charge'
          AND delta < 0
      ),
      -- 1. Put credits back in their original lot where that is still valid.
      restored AS (
        UPDATE credit_lots cl
        SET amount_remaining = cl.amount_remaining + c.amt
        FROM charges c
        WHERE cl.id = c.lot_id
          AND EXISTS (SELECT 1 FROM not_yet)
          AND cl.amount_remaining + c.amt <= cl.amount_granted
          AND (cl.expires_at IS NULL OR cl.expires_at > now())
        RETURNING cl.id AS lot_id, c.class AS class, c.amt AS amt
      ),
      -- 2. Anything that could not go home — expired, deleted, or already
      --    refilled — including pre-lots charges that carry no lot_id.
      orphaned AS (
        SELECT c.user_id, c.class, SUM(c.amt)::int AS amt
        FROM charges c
        WHERE EXISTS (SELECT 1 FROM not_yet)
          AND (
            c.lot_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM restored r WHERE r.lot_id = c.lot_id)
          )
        GROUP BY c.user_id, c.class
      ),
      replacement AS (
        INSERT INTO credit_lots (
          user_id, class, kind, amount_granted, amount_remaining,
          expires_at, source_platform, source_ref
        )
        SELECT
          o.user_id, o.class, 'refund', o.amt, o.amt,
          NULL, 'system',
          -- Per (job, class), so a racing retry collides on the unique
          -- index instead of minting a second replacement lot.
          ${jobId}::text || ':' || o.class
        FROM orphaned o
        WHERE o.amt > 0
        RETURNING id AS lot_id, class, amount_granted AS amt
      ),
      -- 3. Everything that actually moved, from either destination.
      moved AS (
        SELECT lot_id, class, amt FROM restored
        UNION ALL
        SELECT lot_id, class, amt FROM replacement
      ),
      totals AS (
        SELECT
          (SELECT user_id FROM charges LIMIT 1) AS user_id,
          COALESCE(SUM(amt) FILTER (WHERE class = 'promo'), 0)::int        AS r_promo,
          COALESCE(SUM(amt) FILTER (WHERE class = 'subscription'), 0)::int AS r_sub,
          COALESCE(SUM(amt) FILTER (WHERE class = 'topup'), 0)::int        AS r_topup,
          COALESCE(SUM(amt), 0)::int                                       AS r_total
        FROM moved
      ),
      -- 4. Bring the projection back in step with the lots.
      user_credit AS (
        UPDATE users u
        SET
          promo_credits        = u.promo_credits        + t.r_promo,
          subscription_credits = u.subscription_credits + t.r_sub,
          topup_credits        = u.topup_credits        + t.r_topup,
          credits_balance      = u.credits_balance      + t.r_total
        FROM totals t
        WHERE u.id = t.user_id
          AND t.r_total > 0
        RETURNING u.credits_balance AS new_balance
      ),
      ledger AS (
        INSERT INTO credit_ledger (
          user_id, delta, reason, job_id, balance_after, bucket, lot_id, metadata
        )
        -- The ::credit_reason cast is load-bearing: a bare literal resolves
        -- to text and Postgres refuses text -> enum on INSERT ... SELECT.
        SELECT
          t.user_id, m.amt, 'refund'::credit_reason, ${jobId}::uuid,
          uc.new_balance, m.class, m.lot_id,
          jsonb_build_object(
            'rPromo', t.r_promo, 'rSub', t.r_sub, 'rTopup', t.r_topup,
            'restoredToOriginalLot',
              EXISTS (SELECT 1 FROM restored r WHERE r.lot_id = m.lot_id)
          )
        FROM moved m, totals t, user_credit uc
        RETURNING id AS ledger_id
      )
    SELECT ledger_id FROM ledger
  `);

  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  if (rows.length === 0) {
    logger.info('refund:skipped-or-already-applied', { jobId });
    return 0;
  }
  logger.info('refund:applied', { jobId, ledgerRows: rows.length });
  return rows.length;
}
