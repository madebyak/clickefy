/**
 * Refund credits to a user after an infra-class job failure.
 *
 * Mirrors the debit CTE in `apps/api/src/lib/job-create.ts` so the
 * invariant `SUM(credit_ledger.delta WHERE user_id=...) ==
 * users.credits_balance` continues to hold for every account. We
 * refund only when the failure is not the user's fault — bad inputs,
 * unknown_model, or template_missing stay debited because they
 * indicate something the user must change.
 *
 * Idempotency: a refund row is keyed by `(user_id, reason='refund',
 * job_id=<jobId>)`. If we already inserted one for this job, the
 * `NOT EXISTS` predicate short-circuits the chain and no double-
 * credit happens — even if a retry of `failJob()` fires twice.
 *
 * Why here (jobs-worker) and not the API: the orchestrator owns
 * the lifecycle of a job once Trigger.dev picks it up, so it also
 * owns the post-mortem accounting. Plumbing this back through the
 * Worker would add a network hop for no reason.
 */

import { sql } from 'drizzle-orm';

import { logger } from '@trigger.dev/sdk';

import type { JobError } from '@clickfy/db';

import { getDb } from './db';

/**
 * Failure codes that warrant a refund — anything caused by us or
 * an upstream provider. Codes caused by the user's submission
 * (bad inputs, unknown model) are intentionally excluded.
 */
const REFUNDABLE_CODES: ReadonlySet<JobError['code']> = new Set([
  'provider_error',
  'provider_timeout',
  'r2_input_missing',
  'internal_error',
]);

export function isRefundable(code: JobError['code']): boolean {
  return REFUNDABLE_CODES.has(code);
}

/**
 * Issue a refund for `jobId`. No-ops if the job already has a refund
 * ledger entry. Returns the row count affected so the caller can log
 * a `refund_skipped` when it's 0 (idempotent retry).
 */
export async function refundForJob(jobId: string): Promise<number> {
  const db = getDb();

  // Single statement, single round-trip. The CTE chain:
  //   1. job_lookup   → find the job row + cost
  //   2. dup_check    → bail out if a refund already exists for this job
  //   3. user_refund  → UPDATE users.credits_balance += cost
  //   4. ledger       → INSERT credit_ledger row with reason='refund'
  //
  // `RETURNING` from step 4 lets us count affected rows. When the
  // dup_check breaks the chain, RETURNING gives us nothing — we
  // interpret 0 rows as "already refunded" which is the correct
  // idempotent answer.
  const result = await db.execute<{ ledger_id: string }>(sql`
    WITH
      job_lookup AS (
        SELECT j.id, j.user_id, t.cost_credits
        FROM jobs j
        JOIN templates t ON t.id = j.template_id
        WHERE j.id = ${jobId}::uuid
      ),
      dup_check AS (
        SELECT 1
        FROM credit_ledger
        WHERE job_id = ${jobId}::uuid
          AND reason = 'refund'
        LIMIT 1
      ),
      user_refund AS (
        UPDATE users u
        SET credits_balance = credits_balance + job_lookup.cost_credits
        FROM job_lookup
        WHERE u.id = job_lookup.user_id
          AND NOT EXISTS (SELECT 1 FROM dup_check)
        RETURNING u.credits_balance AS balance_after, job_lookup.cost_credits AS amount
      ),
      ledger AS (
        INSERT INTO credit_ledger (
          user_id, delta, reason, job_id, balance_after
        )
        SELECT
          job_lookup.user_id,
          user_refund.amount,
          'refund',
          ${jobId}::uuid,
          user_refund.balance_after
        FROM job_lookup, user_refund
        RETURNING id
      )
    SELECT id AS ledger_id FROM ledger
  `);

  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  if (rows.length === 0) {
    logger.info('refund:skipped-or-already-applied', { jobId });
    return 0;
  }
  logger.info('refund:applied', { jobId });
  return 1;
}
