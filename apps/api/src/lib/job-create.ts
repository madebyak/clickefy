/**
 * `createJobAtomically` — debit credits across three buckets and queue
 * a job in one atomic SQL statement.
 *
 * Three buckets (see `CreditBucket` in `@clickfy/db`):
 *   - `promo`        — welcome bonus / weekly refresh / admin broadcasts.
 *                      Spendable always; never expires.
 *   - `subscription` — granted by the current subscription period. Resets
 *                      to 0 on RC renewal; only present while subscribed.
 *   - `topup`        — purchased one-off pack. Never expires.
 *                      Spendable ONLY while the user has an active
 *                      subscription (entitlement != 'free').
 *
 * Spend order: `promo → subscription → topup`. Rationale:
 *   - `promo` first  — costs us nothing; burn what's effectively free.
 *   - `subscription` next — it'll reset on renewal anyway, no point hoarding.
 *   - `topup` last   — purchased; precious; preserve as long as possible.
 *
 * Atomicity model: same as before — `neon-http` is stateless so we ship
 * the entire decision and mutation as a single CTE chain that Postgres
 * runs as one isolated transaction. Concurrent debits serialize on the
 * row update; the predicates `promo_credits >= from_promo` etc. mean a
 * loser sees the post-debit values and breaks the chain (zero rows
 * returned). The caller treats null as `insufficient_credits`.
 *
 * Output: per-job, we write up to three `credit_ledger` rows (one per
 * bucket where the delta is non-zero), each tagged with `bucket` and a
 * `metadata` blob carrying the full {fromPromo, fromSubscription,
 * fromTopup, cost} breakdown so an operator can answer "where did this
 * charge come from" without re-deriving it.
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
  // null when the client didn't supply an `Idempotency-Key` header.
  idempotencyKey: string | null;
}

export interface CreateJobResult {
  jobId: string;
  creditsRemaining: number;
  fromPromo: number;
  fromSubscription: number;
  fromTopup: number;
}

export async function createJobAtomically(
  db: Db,
  args: CreateJobInput,
): Promise<CreateJobResult | null> {
  const inputsJson = JSON.stringify(args.inputs);
  const optionsJson = JSON.stringify(args.options ?? {});
  const cost = args.cost;

  // Single statement, single round-trip. The CTE chain:
  //   1. template_lookup → template exists and is published
  //   2. version_lookup  → latest version of that template
  //   3. user_snapshot   → user's current bucket balances + sub state
  //   4. alloc           → compute how much to draw from each bucket
  //   5. user_debit      → UPDATE users, three buckets + sum; only fires
  //                        if the allocation is feasible (incl. the
  //                        "topup locked when unsubscribed" rule)
  //   6. new_job         → INSERT jobs row (depends on user_debit)
  //   7. ledger          → INSERT up to 3 credit_ledger rows
  const result = await db.execute<{
    job_id: string;
    credits_remaining: number;
    from_promo: number;
    from_sub: number;
    from_topup: number;
  }>(sql`
    WITH
      template_lookup AS (
        SELECT id, cost_credits
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
      user_snapshot AS (
        SELECT
          id,
          entitlement,
          promo_credits,
          subscription_credits,
          topup_credits,
          (entitlement <> 'free') AS is_subscribed
        FROM users
        WHERE id = ${args.userId}::uuid
      ),
      alloc AS (
        SELECT
          us.id AS user_id,
          LEAST(us.promo_credits, ${cost}::int) AS from_promo,
          LEAST(
            us.subscription_credits,
            GREATEST(0, ${cost}::int - LEAST(us.promo_credits, ${cost}::int))
          ) AS from_sub,
          GREATEST(
            0,
            ${cost}::int
              - LEAST(us.promo_credits, ${cost}::int)
              - LEAST(
                  us.subscription_credits,
                  GREATEST(0, ${cost}::int - LEAST(us.promo_credits, ${cost}::int))
                )
          ) AS need_topup,
          CASE WHEN us.is_subscribed THEN us.topup_credits ELSE 0 END AS spendable_topup
        FROM user_snapshot us
      ),
      user_debit AS (
        UPDATE users
        SET
          promo_credits        = users.promo_credits        - alloc.from_promo,
          subscription_credits = users.subscription_credits - alloc.from_sub,
          topup_credits        = users.topup_credits        - alloc.need_topup,
          credits_balance      = users.credits_balance      - ${cost}::int
        FROM alloc
        WHERE users.id = alloc.user_id
          AND alloc.need_topup <= alloc.spendable_topup
          AND users.promo_credits        >= alloc.from_promo
          AND users.subscription_credits >= alloc.from_sub
          AND users.topup_credits        >= alloc.need_topup
          AND EXISTS (SELECT 1 FROM template_lookup)
          AND EXISTS (SELECT 1 FROM version_lookup)
        RETURNING
          users.credits_balance AS new_balance,
          alloc.from_promo,
          alloc.from_sub,
          alloc.need_topup AS from_topup
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
          user_id, delta, reason, job_id, balance_after, bucket, metadata
        )
        -- Casts are required because UNION ALL unifies branch column
        -- types before the INSERT column-type context kicks in. With
        -- bare 'job_charge' literals the union resolves to text, and
        -- Postgres refuses to implicitly cast text to the user-defined
        -- credit_reason enum. A single ::credit_reason on each branch
        -- makes the union type already-correct.
        SELECT
          ${args.userId}::uuid,
          -ud.from_promo,
          'job_charge'::credit_reason,
          nj.id,
          ud.new_balance,
          'promo',
          jsonb_build_object(
            'fromPromo',        ud.from_promo,
            'fromSubscription', ud.from_sub,
            'fromTopup',        ud.from_topup,
            'cost',             ${cost}::int
          )
        FROM user_debit ud, new_job nj WHERE ud.from_promo > 0
        UNION ALL
        SELECT
          ${args.userId}::uuid,
          -ud.from_sub,
          'job_charge'::credit_reason,
          nj.id,
          ud.new_balance,
          'subscription',
          jsonb_build_object(
            'fromPromo',        ud.from_promo,
            'fromSubscription', ud.from_sub,
            'fromTopup',        ud.from_topup,
            'cost',             ${cost}::int
          )
        FROM user_debit ud, new_job nj WHERE ud.from_sub > 0
        UNION ALL
        SELECT
          ${args.userId}::uuid,
          -ud.from_topup,
          'job_charge'::credit_reason,
          nj.id,
          ud.new_balance,
          'topup',
          jsonb_build_object(
            'fromPromo',        ud.from_promo,
            'fromSubscription', ud.from_sub,
            'fromTopup',        ud.from_topup,
            'cost',             ${cost}::int
          )
        FROM user_debit ud, new_job nj WHERE ud.from_topup > 0
        RETURNING id
      )
    SELECT
      nj.id          AS job_id,
      ud.new_balance AS credits_remaining,
      ud.from_promo  AS from_promo,
      ud.from_sub    AS from_sub,
      ud.from_topup  AS from_topup
    FROM new_job nj, user_debit ud
  `);

  // `neon-http` returns `{ rows: T[] }`; Drizzle's `execute` exposes it
  // as an array directly. Empty array = CTE chain broke somewhere
  // (template missing, no version, insufficient credits, topup locked
  // because unsubscribed, or a race).
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  if (rows.length === 0) return null;

  const row = rows[0] as {
    job_id: string;
    credits_remaining: number;
    from_promo: number;
    from_sub: number;
    from_topup: number;
  };
  return {
    jobId: row.job_id,
    creditsRemaining: row.credits_remaining,
    fromPromo: row.from_promo,
    fromSubscription: row.from_sub,
    fromTopup: row.from_topup,
  };
}
