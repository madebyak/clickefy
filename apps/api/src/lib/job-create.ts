/**
 * `createJobAtomically` / `createUserJobAtomically` — allocate credits
 * across a user's credit lots and queue a job, in ONE atomic statement.
 *
 * ─── The credit model ───────────────────────────────────────────────
 *
 * Credits live in `credit_lots` (migration 0029): one row per grant, each
 * with its own `expires_at`. The three columns on `users`
 * (`promo/subscription/topup_credits`) plus `credits_balance` are a
 * PROJECTION of those lots, maintained in the same statement, so a balance
 * read stays one row and the 0015 CHECK still applies.
 *
 * Spend order is not a hardcoded list. It is one rule:
 *
 *     ORDER BY expires_at ASC NULLS LAST, created_at ASC
 *
 * which produces subscription (expires at period end) → top-up (12 months)
 * → welcome/promo (never) on its own. Spending what expires soonest is
 * both the industry norm and the only order that keeps our promise that
 * free credits last until everything else is gone.
 *
 * Eligibility is separate from ordering: top-up credits are only spendable
 * while the user has an active subscription.
 *
 * ─── Why one statement, and how it stays safe under concurrency ──────
 *
 * `neon-http` has no interactive transactions — `db.transaction()` throws
 * outright — so the whole decision and mutation ships as a single CTE
 * chain that Postgres executes as one implicit transaction. That is the
 * correct tool here, not a workaround: the allocation depends on values
 * read in the same breath.
 *
 * The serialization point is the SINGLE `users` row. Its UPDATE carries
 * per-bucket guards (`promo_credits >= t_promo`, …). Postgres re-evaluates
 * those against the freshly-committed row after a concurrent writer
 * releases its lock, so a loser matches zero rows, the whole chain
 * collapses, and the caller reports `insufficient_credits`. This is the
 * same proven mechanism the previous bucket-only implementation used.
 *
 * One rarer race remains and is handled by failing closed rather than by
 * being prevented: the per-lot split is computed from the statement's
 * snapshot, so a concurrent spend could leave a specific lot short even
 * when the aggregate buckets still cover the cost. Deliberately there is
 * NO per-lot `amount_remaining >= take` guard — skipping just the short
 * lot would decrement the buckets by more than the lots, silently breaking
 * the projection. Instead the lot's own
 * `credit_lots_remaining_range` CHECK fires, Postgres rolls the entire
 * statement back, and `isCreditRace()` maps it to the same retryable
 * error. Nothing is ever half-applied: an error rolls back the statement,
 * including every CTE inside it.
 *
 * ─── Output ─────────────────────────────────────────────────────────
 *
 * One `credit_ledger` row per LOT touched, carrying `lot_id` so a refund
 * can return credits to exactly the lots the charge drew from, plus the
 * usual `{fromPromo, fromSubscription, fromTopup, cost}` breakdown.
 */

import { sql, type SQL } from 'drizzle-orm';

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
  /**
   * Web-studio project to file the outputs into. Ownership is verified
   * by the route BEFORE the debit; NULL (mobile / unfiled) leaves the
   * flat-history behavior untouched.
   */
  projectId?: string | null;
}

export interface CreateJobResult {
  jobId: string;
  creditsRemaining: number;
  fromPromo: number;
  fromSubscription: number;
  fromTopup: number;
}

/**
 * Postgres raised because a lot would have gone negative — the rare
 * stale-allocation race described in the header. The statement rolled
 * back; the caller should surface "credits changed, try again", exactly
 * as it does for the zero-rows case.
 */
export function isCreditRace(err: unknown): boolean {
  const e = err as { constraint?: string; message?: string };
  return (
    e?.constraint === 'credit_lots_remaining_range' ||
    /credit_lots_remaining_range/.test(e?.message ?? '')
  );
}

/**
 * The allocation CTEs, shared verbatim by both money paths.
 *
 * The template and create flows deliberately keep SEPARATE top-level
 * statements so a change to one cannot alter the other's shape. The
 * allocation itself, though, is identical and subtle enough that having
 * two hand-maintained copies is the greater risk — a fix applied to one
 * and missed on the other is exactly how the Seedance tier bug happened.
 *
 * Produces CTEs: `user_snapshot`, `ranked`, `alloc`, `totals`.
 */
function allocationCtes(userId: string, cost: number): SQL {
  return sql`
      user_snapshot AS (
        SELECT id, (entitlement <> 'free') AS is_subscribed
        FROM users
        WHERE id = ${userId}::uuid
      ),
      -- Eligible lots, soonest expiry first, with a running total so each
      -- lot knows how much of the cost was already covered before it.
      ranked AS (
        SELECT
          cl.id,
          cl.class,
          cl.amount_remaining,
          SUM(cl.amount_remaining) OVER (
            ORDER BY cl.expires_at ASC NULLS LAST, cl.created_at ASC, cl.id ASC
            ROWS UNBOUNDED PRECEDING
          ) AS running_total
        FROM credit_lots cl, user_snapshot us
        WHERE cl.user_id = us.id
          AND cl.amount_remaining > 0
          -- Top-ups need an active subscription; everything else is free
          -- to spend. This is eligibility, not ordering.
          AND (cl.class <> 'topup' OR us.is_subscribed)
      ),
      -- What each lot contributes. A lot is involved only while the cost
      -- is not yet covered by the lots ahead of it.
      alloc AS (
        SELECT
          id,
          class,
          LEAST(amount_remaining, ${cost}::int - (running_total - amount_remaining)) AS take
        FROM ranked
        WHERE running_total - amount_remaining < ${cost}::int
      ),
      totals AS (
        SELECT
          COALESCE(SUM(take) FILTER (WHERE class = 'promo'), 0)::int        AS t_promo,
          COALESCE(SUM(take) FILTER (WHERE class = 'subscription'), 0)::int AS t_sub,
          COALESCE(SUM(take) FILTER (WHERE class = 'topup'), 0)::int        AS t_topup,
          COALESCE(SUM(take), 0)::int                                      AS t_all
        FROM alloc
      )`;
}

/**
 * The `users` projection update — the serialization point.
 *
 * Guards are what make concurrent spends safe: `t_all = cost` refuses a
 * short allocation (not enough eligible credits), and the three
 * `>= t_*` predicates are re-evaluated by Postgres against the current row
 * if another spend committed while we waited, so a loser matches zero rows.
 */
function userDebitCte(userId: string, cost: number, extraGuards: SQL = sql``): SQL {
  return sql`
      user_debit AS (
        UPDATE users u
        SET
          promo_credits        = u.promo_credits        - t.t_promo,
          subscription_credits = u.subscription_credits - t.t_sub,
          topup_credits        = u.topup_credits        - t.t_topup,
          credits_balance      = u.credits_balance      - ${cost}::int
        FROM totals t
        WHERE u.id = ${userId}::uuid
          AND t.t_all = ${cost}::int
          AND u.promo_credits        >= t.t_promo
          AND u.subscription_credits >= t.t_sub
          AND u.topup_credits        >= t.t_topup
          ${extraGuards}
        RETURNING
          u.credits_balance AS new_balance,
          t.t_promo, t.t_sub, t.t_topup
      ),
      -- Apply the per-lot split. Gated on the users row having actually
      -- moved, so a refused debit never touches a lot. No per-lot guard
      -- here on purpose — see the header: skipping a short lot would break
      -- the projection, so we let the CHECK roll the statement back.
      lot_debit AS (
        UPDATE credit_lots cl
        SET amount_remaining = cl.amount_remaining - a.take
        FROM alloc a
        WHERE cl.id = a.id
          AND EXISTS (SELECT 1 FROM user_debit)
        RETURNING cl.id AS lot_id, a.class AS lot_class, a.take AS lot_take
      )`;
}

/** One ledger row per lot touched, tagged with the lot it moved. */
function ledgerCte(userId: string, cost: number, jobSource: 'template' | 'create'): SQL {
  const sourceTag =
    jobSource === 'create' ? sql`, 'source', 'create'` : sql``;
  return sql`
      ledger AS (
        INSERT INTO credit_ledger (
          user_id, delta, reason, job_id, balance_after, bucket, lot_id, metadata
        )
        -- The ::credit_reason cast is load-bearing: without it the literal
        -- resolves to text and Postgres refuses text -> enum on
        -- INSERT ... SELECT.
        SELECT
          ${userId}::uuid,
          -ld.lot_take,
          'job_charge'::credit_reason,
          nj.id,
          ud.new_balance,
          ld.lot_class,
          ld.lot_id,
          jsonb_build_object(
            'fromPromo',        ud.t_promo,
            'fromSubscription', ud.t_sub,
            'fromTopup',        ud.t_topup,
            'cost',             ${cost}::int
            ${sourceTag}
          )
        FROM lot_debit ld, new_job nj, user_debit ud
        RETURNING id
      )`;
}

/** Shared result-row decoding for both paths. */
function decode(result: unknown): CreateJobResult | null {
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
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

export async function createJobAtomically(
  db: Db,
  args: CreateJobInput,
): Promise<CreateJobResult | null> {
  const inputsJson = JSON.stringify(args.inputs);
  const optionsJson = JSON.stringify(args.options ?? {});
  const cost = args.cost;

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
      ${allocationCtes(args.userId, cost)},
      ${userDebitCte(
        args.userId,
        cost,
        sql`AND EXISTS (SELECT 1 FROM template_lookup)
          AND EXISTS (SELECT 1 FROM version_lookup)`,
      )},
      new_job AS (
        INSERT INTO jobs (
          user_id, template_id, template_version_id, project_id,
          status, inputs, options, idempotency_key
        )
        SELECT
          ${args.userId}::uuid,
          ${args.templateId}::uuid,
          version_lookup.id,
          ${args.projectId ?? null}::uuid,
          'queued',
          ${inputsJson}::jsonb,
          ${optionsJson}::jsonb,
          ${args.idempotencyKey}
        FROM user_debit, version_lookup
        RETURNING id
      ),
      ${ledgerCte(args.userId, cost, 'template')}
    SELECT
      nj.id          AS job_id,
      ud.new_balance AS credits_remaining,
      ud.t_promo     AS from_promo,
      ud.t_sub       AS from_sub,
      ud.t_topup     AS from_topup
    FROM new_job nj, user_debit ud
  `);

  return decode(result);
}

// ─── Create-flow (prompt-first, no template) ────────────────────────

export interface CreateUserJobInput {
  userId: string;
  /** Resolved per-tier cost from `provider_models`. */
  cost: number;
  /** The model the user picked (persisted on the job row). */
  modelKey: string;
  /** Already-assembled `jobs.inputs` (prompt + optional attachments). */
  inputs: Record<string, JobInputValueParsed>;
  options: { aspectRatio?: string; duration?: number };
  idempotencyKey: string | null;
  projectId?: string | null;
}

/**
 * The prompt-first sibling of `createJobAtomically`. Identical allocation
 * (shared above), but with NO template/version gates — a create job has no
 * template — and an inserted row carrying `source='user'`, `model_key`,
 * `cost_credits` and NULL template FKs.
 *
 * Kept as a separate top-level statement so the production template
 * money-path cannot be reshaped by a change here.
 */
export async function createUserJobAtomically(
  db: Db,
  args: CreateUserJobInput,
): Promise<CreateJobResult | null> {
  const inputsJson = JSON.stringify(args.inputs);
  const optionsJson = JSON.stringify(args.options ?? {});
  const cost = args.cost;

  const result = await db.execute<{
    job_id: string;
    credits_remaining: number;
    from_promo: number;
    from_sub: number;
    from_topup: number;
  }>(sql`
    WITH
      ${allocationCtes(args.userId, cost)},
      ${userDebitCte(args.userId, cost)},
      new_job AS (
        INSERT INTO jobs (
          user_id, template_id, template_version_id, project_id,
          source, model_key, cost_credits,
          status, inputs, options, idempotency_key
        )
        SELECT
          ${args.userId}::uuid, NULL, NULL, ${args.projectId ?? null}::uuid,
          'user', ${args.modelKey}, ${cost}::int,
          'queued', ${inputsJson}::jsonb, ${optionsJson}::jsonb, ${args.idempotencyKey}
        FROM user_debit
        RETURNING id
      ),
      ${ledgerCte(args.userId, cost, 'create')}
    SELECT
      nj.id          AS job_id,
      ud.new_balance AS credits_remaining,
      ud.t_promo     AS from_promo,
      ud.t_sub       AS from_sub,
      ud.t_topup     AS from_topup
    FROM new_job nj, user_debit ud
  `);

  return decode(result);
}
