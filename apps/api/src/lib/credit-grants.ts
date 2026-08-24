/**
 * Credit grants, revocations and the top-up expiry clock — the ONE place
 * credits are created or destroyed outside a job charge.
 *
 * Every path that hands out credits (welcome bonus, subscription renewal,
 * credit-pack purchase, admin adjustment) funnels through `grantCredits`
 * so all of them write a lot, move the projection and append to the ledger
 * in a single atomic statement. Before this existed each caller did its own
 * two-step UPDATE-then-INSERT, which meant a mid-flight failure could
 * credit a user with no ledger row to explain it.
 *
 * Everything here is one CTE per operation, because `neon-http` has no
 * interactive transactions (`db.transaction()` throws) and each of these
 * needs a write that depends on a read.
 */

import { sql } from 'drizzle-orm';

import type { Db } from '@clickfy/db';
import type { CreditLotClass, CreditLotKind } from '@clickfy/db';

/**
 * How long a bought credit pack lives.
 *
 * Deliberately gentler than the 90 days Higgsfield uses, because we sell
 * through Apple and Google where "my credits vanished" is a one-tap
 * refund and a review risk. The clock also PAUSES while the user is
 * unsubscribed (`pauseTopupClocks`), so nobody loses time they were not
 * allowed to spend.
 *
 * Lives here rather than in a webhook file because two payment paths now
 * grant top-ups — RevenueCat and Stripe — and a lifetime that differed
 * between storefronts would be indefensible to the customer who noticed.
 */
export const TOPUP_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export interface GrantCreditsInput {
  userId: string;
  /** Which wallet, and therefore how it is gated and ordered when spent. */
  class: CreditLotClass;
  kind: CreditLotKind;
  amount: number;
  /** Absolute expiry; omit for credits that never expire. */
  expiresAt?: Date | null;
  /** 'stripe' | 'app_store' | 'play_store' | 'admin' | 'system'. */
  sourcePlatform?: string | null;
  /**
   * The external event id. Combined with `(user_id, kind)` in a partial
   * unique index this is what makes a replayed webhook a no-op rather than
   * a double grant — pass the provider's event/transaction id whenever
   * there is one.
   */
  sourceRef?: string | null;
  /** `credit_ledger.reason`. Must be a valid `credit_reason` enum value. */
  reason: string;
  note?: string | null;
  metadata?: Record<string, unknown>;
}

export interface GrantResult {
  lotId: string;
  newBalance: number;
}

/**
 * Issue credits. Returns null when nothing was written because a lot with
 * this `(user, kind, sourceRef)` already exists — i.e. a replay.
 */
export async function grantCredits(
  db: Db,
  input: GrantCreditsInput,
): Promise<GrantResult | null> {
  if (input.amount <= 0) return null;
  const meta = JSON.stringify(input.metadata ?? {});

  const result = await db.execute<{ lot_id: string; new_balance: number }>(sql`
    WITH
      new_lot AS (
        INSERT INTO credit_lots (
          user_id, class, kind, amount_granted, amount_remaining,
          expires_at, source_platform, source_ref
        )
        VALUES (
          ${input.userId}::uuid, ${input.class}, ${input.kind},
          ${input.amount}::int, ${input.amount}::int,
          ${input.expiresAt ? input.expiresAt.toISOString() : null}::timestamptz,
          ${input.sourcePlatform ?? null}, ${input.sourceRef ?? null}
        )
        -- A replayed webhook carries the same source_ref and loses here,
        -- leaving the rest of the chain with nothing to do.
        ON CONFLICT (user_id, kind, source_ref) WHERE source_ref IS NOT NULL
        DO NOTHING
        RETURNING id, class, amount_granted
      ),
      bumped AS (
        UPDATE users u
        SET
          promo_credits        = u.promo_credits        + CASE WHEN nl.class = 'promo'        THEN nl.amount_granted ELSE 0 END,
          subscription_credits = u.subscription_credits + CASE WHEN nl.class = 'subscription' THEN nl.amount_granted ELSE 0 END,
          topup_credits        = u.topup_credits        + CASE WHEN nl.class = 'topup'        THEN nl.amount_granted ELSE 0 END,
          credits_balance      = u.credits_balance      + nl.amount_granted
        FROM new_lot nl
        WHERE u.id = ${input.userId}::uuid
        RETURNING u.credits_balance AS new_balance
      ),
      entry AS (
        INSERT INTO credit_ledger (
          user_id, delta, reason, balance_after, bucket, lot_id, note, metadata
        )
        SELECT
          ${input.userId}::uuid, nl.amount_granted,
          ${input.reason}::credit_reason, b.new_balance, nl.class, nl.id,
          ${input.note ?? null}, ${meta}::jsonb
        FROM new_lot nl, bumped b
        RETURNING id
      )
    SELECT nl.id AS lot_id, b.new_balance
    FROM new_lot nl, bumped b
  `);

  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  if (rows.length === 0) return null;
  const row = rows[0] as { lot_id: string; new_balance: number };
  return { lotId: row.lot_id, newBalance: row.new_balance };
}

/**
 * Take credits back — a store refund clawback, or an admin deduction.
 *
 * Drains lots in the SAME order a spend would (soonest expiry first) and
 * is clamped at what is actually there: if the user already spent the
 * credits we absorb the difference rather than pushing them negative,
 * which the balance CHECK would reject anyway.
 *
 * Returns how much was actually reclaimed.
 */
export async function revokeCredits(
  db: Db,
  input: {
    userId: string;
    /** Restrict to one wallet (a pack refund only touches top-ups). */
    class?: CreditLotClass;
    amount: number;
    reason: string;
    note?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<number> {
  if (input.amount <= 0) return 0;
  const meta = JSON.stringify(input.metadata ?? {});
  const classFilter = input.class ? sql`AND cl.class = ${input.class}` : sql``;

  const result = await db.execute<{ clawed: number }>(sql`
    WITH
      ranked AS (
        SELECT cl.id, cl.class, cl.amount_remaining,
          SUM(cl.amount_remaining) OVER (
            ORDER BY cl.expires_at ASC NULLS LAST, cl.created_at ASC, cl.id ASC
            ROWS UNBOUNDED PRECEDING
          ) AS running_total
        FROM credit_lots cl
        WHERE cl.user_id = ${input.userId}::uuid
          AND cl.amount_remaining > 0
          ${classFilter}
      ),
      alloc AS (
        SELECT id, class,
          LEAST(amount_remaining, ${input.amount}::int - (running_total - amount_remaining)) AS take
        FROM ranked
        WHERE running_total - amount_remaining < ${input.amount}::int
      ),
      totals AS (
        SELECT
          COALESCE(SUM(take) FILTER (WHERE class = 'promo'), 0)::int        AS t_promo,
          COALESCE(SUM(take) FILTER (WHERE class = 'subscription'), 0)::int AS t_sub,
          COALESCE(SUM(take) FILTER (WHERE class = 'topup'), 0)::int        AS t_topup,
          COALESCE(SUM(take), 0)::int                                       AS t_all
        FROM alloc
      ),
      user_debit AS (
        UPDATE users u
        SET
          promo_credits        = u.promo_credits        - t.t_promo,
          subscription_credits = u.subscription_credits - t.t_sub,
          topup_credits        = u.topup_credits        - t.t_topup,
          credits_balance      = u.credits_balance      - t.t_all
        FROM totals t
        WHERE u.id = ${input.userId}::uuid
          AND t.t_all > 0
          AND u.promo_credits        >= t.t_promo
          AND u.subscription_credits >= t.t_sub
          AND u.topup_credits        >= t.t_topup
        RETURNING u.credits_balance AS new_balance, t.t_all
      ),
      lot_debit AS (
        UPDATE credit_lots cl
        SET amount_remaining = cl.amount_remaining - a.take
        FROM alloc a
        WHERE cl.id = a.id AND EXISTS (SELECT 1 FROM user_debit)
        RETURNING cl.id AS lot_id, a.class AS lot_class, a.take AS lot_take
      ),
      entry AS (
        INSERT INTO credit_ledger (
          user_id, delta, reason, balance_after, bucket, lot_id, note, metadata
        )
        SELECT
          ${input.userId}::uuid, -ld.lot_take, ${input.reason}::credit_reason,
          ud.new_balance, ld.lot_class, ld.lot_id, ${input.note ?? null}, ${meta}::jsonb
        FROM lot_debit ld, user_debit ud
        RETURNING id
      )
    SELECT ud.t_all AS clawed FROM user_debit ud
  `);

  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  if (rows.length === 0) return 0;
  return (rows[0] as { clawed: number }).clawed;
}

/**
 * Stop the expiry clock on a user's top-up lots.
 *
 * Called when a subscription lapses. Top-ups are unspendable while
 * unsubscribed, so letting their 12-month clock keep running would burn
 * time the user cannot use — the "I came back and my credits were gone"
 * complaint. The remaining life is parked and `expires_at` cleared, which
 * the `credit_lots_pause_coherent` CHECK requires to happen together.
 */
export async function pauseTopupClocks(db: Db, userId: string): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE credit_lots
    SET remaining_lifetime = GREATEST(expires_at - now(), interval '0'),
        paused_at          = now(),
        expires_at         = NULL
    WHERE user_id = ${userId}::uuid
      AND class = 'topup'
      AND paused_at IS NULL
      AND expires_at IS NOT NULL
    RETURNING id
  `);
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  return rows.length;
}

/** Restart a paused clock from wherever it stopped. */
export async function resumeTopupClocks(db: Db, userId: string): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE credit_lots
    SET expires_at         = now() + remaining_lifetime,
        paused_at          = NULL,
        remaining_lifetime = NULL
    WHERE user_id = ${userId}::uuid
      AND class = 'topup'
      AND paused_at IS NOT NULL
    RETURNING id
  `);
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  return rows.length;
}

/**
 * Close out a user's subscription lots — the use-it-or-lose-it reset that
 * runs on renewal, plan change and expiry. Zeroes the lots, drops the
 * projection by the same amount and records what was forfeited.
 *
 * Returns the number of credits that were still unspent.
 */
export async function closeSubscriptionLots(
  db: Db,
  userId: string,
  note: string,
): Promise<number> {
  // Read the outstanding total first. A single statement cannot both zero
  // the lots and report what they held, because `RETURNING` on an UPDATE
  // exposes the NEW value. Splitting it is safe here in a way it would not
  // be on the spend path: this runs only from webhook handlers, the second
  // statement is guarded on the same total, and a lost race simply means
  // the next delivery of the event re-runs it.
  const pre = await db.execute<{ forfeited: number }>(sql`
    SELECT COALESCE(SUM(amount_remaining), 0)::int AS forfeited
    FROM credit_lots
    WHERE user_id = ${userId}::uuid AND class = 'subscription' AND amount_remaining > 0
  `);
  const preRows = Array.isArray(pre) ? pre : ((pre as { rows?: unknown[] }).rows ?? []);
  const forfeited = (preRows[0] as { forfeited: number } | undefined)?.forfeited ?? 0;
  if (forfeited <= 0) return 0;

  // Zero the lots, drop the projection by exactly that amount and record
  // the forfeit — all gated on the projection still holding it, so a
  // concurrent spend makes this a no-op rather than a double subtraction.
  await db.execute(sql`
    WITH
      closed AS (
        UPDATE credit_lots
        SET amount_remaining = 0
        WHERE user_id = ${userId}::uuid
          AND class = 'subscription'
          AND amount_remaining > 0
        RETURNING id
      ),
      bumped AS (
        UPDATE users u
        SET subscription_credits = u.subscription_credits - ${forfeited}::int,
            credits_balance      = u.credits_balance      - ${forfeited}::int
        WHERE u.id = ${userId}::uuid
          AND u.subscription_credits >= ${forfeited}::int
          AND EXISTS (SELECT 1 FROM closed)
        RETURNING u.credits_balance AS new_balance
      )
    INSERT INTO credit_ledger (user_id, delta, reason, balance_after, bucket, note, metadata)
    SELECT ${userId}::uuid, -${forfeited}::int, 'subscription_reset'::credit_reason,
           b.new_balance, 'subscription', ${note}, '{}'::jsonb
    FROM bumped b
  `);

  return forfeited;
}
