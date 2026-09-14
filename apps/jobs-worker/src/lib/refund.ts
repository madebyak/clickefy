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
 * The ledger records ONE refund row per bucket (see `refund-sql.ts`), with
 * the individual lots in its metadata.
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
import { refundStatement } from './refund-sql';

const REFUNDABLE_CODES: ReadonlySet<JobError['code']> = new Set([
  'provider_error',
  'provider_timeout',
  'r2_input_missing',
  'internal_error',
]);

export function isRefundable(code: JobError['code']): boolean {
  return REFUNDABLE_CODES.has(code);
}

function rowsOf(result: unknown): unknown[] {
  return Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
}

export async function refundForJob(jobId: string): Promise<number> {
  const db = getDb();
  try {
    return await runRefund(db, jobId);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === '23505' || /duplicate key value/i.test(e?.message ?? '')) {
      // A unique violation MAY mean a concurrent refund (sweeper + failJob
      // racing) won and the loser's statement rolled back. But it may also
      // be this statement colliding with itself — which is exactly how a
      // multi-lot charge silently went unrefunded while this branch logged
      // "already refunded". So confirm instead of assuming: only a refund
      // row that actually exists makes this a lost race.
      const existing = await db.execute(sql`
        SELECT 1 FROM credit_ledger
        WHERE job_id = ${jobId}::uuid AND reason = 'refund'
        LIMIT 1
      `);
      if (rowsOf(existing).length > 0) {
        logger.info('refund:lost-concurrent-race (already refunded)', { jobId });
        return 0;
      }
      logger.error('refund:unique-violation-without-refund', { jobId, err: String(err) });
    }
    throw err;
  }
}

async function runRefund(db: ReturnType<typeof getDb>, jobId: string): Promise<number> {
  const result = await db.execute<{ ledger_id: string }>(refundStatement(jobId));
  const rows = rowsOf(result);
  if (rows.length === 0) {
    logger.info('refund:skipped-or-already-applied', { jobId });
    return 0;
  }
  logger.info('refund:applied', { jobId, ledgerRows: rows.length });
  return rows.length;
}
