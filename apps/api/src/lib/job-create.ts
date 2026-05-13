/**
 * `createJobAtomically` — debit credits and queue a job in one atomic
 * SQL statement.
 *
 * Why one statement: the Worker uses Drizzle's `neon-http` driver
 * (stateless HTTPS), which doesn't support interactive transactions
 * (`tx.select(...)` inside a `db.transaction(cb)` cannot branch on the
 * intermediate result — the callback's statements are batched and sent
 * as one round-trip, no read-back). The classic remedy is a CTE chain:
 * one SQL statement that runs as a single, isolated transaction
 * server-side and either succeeds in full or makes no change.
 *
 * The chain in order:
 *
 *   ┌─ template_lookup ─┐   confirm template is published, capture cost
 *   ├─ version_lookup ──┤   pick newest template_version (snapshot ptr)
 *   ├─ user_debit ──────┤   UPDATE users.credits_balance, ONLY if balance
 *   │                   │   ≥ cost AND template/version exist
 *   ├─ new_job ─────────┤   INSERT jobs (depends on user_debit row)
 *   └─ ledger ──────────┘   INSERT credit_ledger (depends on new_job row)
 *
 * If anything upstream returns 0 rows, the chain breaks: no debit, no
 * job row, no ledger row. Postgres serializes concurrent UPDATEs on the
 * same `users.id`, so a double-submit either both see the original
 * balance and one wins, or one sees the post-debit balance and fails
 * the `credits_balance >= cost` predicate. Either way, the invariant
 * (ledger SUM == users.credits_balance delta) holds.
 *
 * Returning shape: `{ jobId, creditsRemaining }` on success, or `null`
 * when the CTE broke. The caller is expected to have already
 * pre-validated and pre-checked balance (so a `null` here means a
 * race: someone submitted concurrently and ate our credits). The
 * caller translates that into an `insufficient_credits` response.
 */

import { sql } from 'drizzle-orm';

import type { Db } from '@clickfy/db';
import type { JobInputValueParsed } from './job-schemas';

export interface CreateJobInput {
  userId: string;
  templateId: string;
  cost: number;
  inputs: Record<string, JobInputValueParsed>;
  options: { aspectRatio?: string };
  // null when the client didn't supply an `Idempotency-Key` header. We
  // store it as-is so a duplicate submit returns the same job row from
  // the idempotency lookup the caller does before invoking us.
  idempotencyKey: string | null;
}

export interface CreateJobResult {
  jobId: string;
  creditsRemaining: number;
}

export async function createJobAtomically(
  db: Db,
  args: CreateJobInput,
): Promise<CreateJobResult | null> {
  const inputsJson = JSON.stringify(args.inputs);
  const optionsJson = JSON.stringify(args.options ?? {});
  // Pre-negate in JS rather than emitting `-${cost}` in SQL. Postgres
  // can't resolve the unary `-` operator against an untyped bind
  // parameter (`ERROR: operator is not unique: - unknown`); passing
  // the already-signed integer side-steps the ambiguity completely.
  const debit = -args.cost;

  // The CTE has to be a single raw SQL statement to fit `neon-http`.
  // We use Drizzle's `sql` template for parameter binding so values
  // are escaped properly; no string concatenation of user data.
  const result = await db.execute<{
    job_id: string;
    credits_remaining: number;
  }>(sql`
    WITH
      template_lookup AS (
        SELECT id, cost_credits, status
        FROM templates
        WHERE id = ${args.templateId}::uuid
          AND status = 'published'
      ),
      version_lookup AS (
        SELECT id
        FROM template_versions
        WHERE template_id = ${args.templateId}::uuid
        ORDER BY version_number DESC
        LIMIT 1
      ),
      user_debit AS (
        UPDATE users
        SET credits_balance = credits_balance - ${args.cost}
        WHERE id = ${args.userId}::uuid
          AND credits_balance >= ${args.cost}
          AND EXISTS (SELECT 1 FROM template_lookup)
          AND EXISTS (SELECT 1 FROM version_lookup)
        RETURNING credits_balance AS balance_after
      ),
      new_job AS (
        INSERT INTO jobs (
          user_id, template_id, template_version_id,
          status, inputs, options, idempotency_key
        )
        SELECT
          ${args.userId}::uuid,
          ${args.templateId}::uuid,
          version_lookup.id,
          'queued',
          ${inputsJson}::jsonb,
          ${optionsJson}::jsonb,
          ${args.idempotencyKey}
        FROM user_debit, version_lookup
        RETURNING id
      ),
      ledger AS (
        INSERT INTO credit_ledger (
          user_id, delta, reason, job_id, balance_after
        )
        SELECT
          ${args.userId}::uuid,
          ${debit},
          'job_charge',
          new_job.id,
          user_debit.balance_after
        FROM new_job, user_debit
        RETURNING id
      )
    SELECT
      new_job.id AS job_id,
      user_debit.balance_after AS credits_remaining
    FROM new_job, user_debit
  `);

  // `neon-http` returns `{ rows: T[] }`; Drizzle's `execute` exposes it
  // as an array directly. Empty array = CTE chain broke somewhere
  // (template missing, no version, insufficient credits, or race).
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  if (rows.length === 0) return null;

  const row = rows[0] as { job_id: string; credits_remaining: number };
  return {
    jobId: row.job_id,
    creditsRemaining: row.credits_remaining,
  };
}
