/**
 * The refund statement, on its own — no logger, no env, no connection —
 * so it can be exercised against a real database inside a rolled-back
 * transaction. `refund.ts` owns running it and interpreting the result;
 * the design notes live there.
 */

import { sql, type SQL } from 'drizzle-orm';

export function refundStatement(jobId: string): SQL {
  // One statement. Postgres runs the whole CTE chain as a single implicit
  // transaction, so either every lot, the projection and the ledger move
  // together, or nothing does.
  return sql`
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
      -- 5. ONE ledger row per bucket, never one per lot.
      --
      --    \`credit_ledger_refund_unique_idx\` allows a single refund row per
      --    (job_id, bucket). A job is charged one row per LOT it drew from,
      --    so a charge spread across two lots of the same bucket used to
      --    produce two refund rows here: the second INSERT hit the index,
      --    the whole statement rolled back, and the caller mistook the
      --    unique violation for a concurrent refund. The user kept being
      --    told they were refunded (prod job f8184378, 2026-09-07: 8 + 14
      --    credits from two promo lots, never returned).
      --
      --    Summing per bucket keeps the ledger explaining the balance to
      --    the credit; which lots the credits went back to is kept in
      --    metadata, and \`lot_id\` is still set whenever it was just one.
      per_bucket AS (
        SELECT
          m.class,
          SUM(m.amt)::int AS amt,
          CASE WHEN COUNT(*) = 1 THEN (array_agg(m.lot_id))[1] END AS lot_id,
          jsonb_agg(
            jsonb_build_object(
              'lotId', m.lot_id,
              'amount', m.amt,
              'restoredToOriginalLot',
                EXISTS (SELECT 1 FROM restored r WHERE r.lot_id = m.lot_id)
            )
          ) AS lots,
          bool_and(EXISTS (SELECT 1 FROM restored r WHERE r.lot_id = m.lot_id))
            AS all_restored
        FROM moved m
        GROUP BY m.class
      ),
      ledger AS (
        INSERT INTO credit_ledger (
          user_id, delta, reason, job_id, balance_after, bucket, lot_id, metadata
        )
        -- The ::credit_reason cast is load-bearing: a bare literal resolves
        -- to text and Postgres refuses text -> enum on INSERT ... SELECT.
        SELECT
          t.user_id, b.amt, 'refund'::credit_reason, ${jobId}::uuid,
          uc.new_balance, b.class, b.lot_id,
          jsonb_build_object(
            'rPromo', t.r_promo, 'rSub', t.r_sub, 'rTopup', t.r_topup,
            'restoredToOriginalLot', b.all_restored,
            'lots', b.lots
          )
        FROM per_bucket b, totals t, user_credit uc
        RETURNING id AS ledger_id
      )
    SELECT ledger_id FROM ledger
  `;
}
