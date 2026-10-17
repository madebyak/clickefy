/**
 * `chargeCredits()` — debit a user for something that is not a job.
 *
 * The first such thing is making a voice (a clone or a design). The money
 * mechanics are exactly the job charge's: the same lot allocation, the
 * same guarded `users` update that makes concurrent spends safe, one
 * ledger row per lot touched. Only the reason differs (`voice_charge`)
 * and there is no job id; what was bought sits in `metadata`.
 *
 * Returns null when the user cannot cover the cost — the caller decides
 * what to tell them. Callers should do the external work first and charge
 * after it succeeded, so a refused charge never needs a refund (undo the
 * external work instead).
 */

import { sql, type Db } from '@clickfy/db';

import { allocationCtes, userDebitCte } from './job-create';

export interface ChargeCreditsInput {
  userId: string;
  cost: number;
  reason: 'voice_charge';
  /** What the credits bought; lands on every ledger row of this charge. */
  metadata: Record<string, string | number | boolean | null>;
}

export interface ChargeCreditsResult {
  creditsRemaining: number;
  fromPromo: number;
  fromSubscription: number;
  fromTopup: number;
}

export async function chargeCredits(db: Db, input: ChargeCreditsInput): Promise<ChargeCreditsResult | null> {
  const { userId, cost } = input;
  if (!Number.isInteger(cost) || cost <= 0) throw new Error(`chargeCredits: cost must be a positive integer, got ${cost}`);
  const meta = JSON.stringify(input.metadata);
  const result = await db.execute(sql`
    WITH
      ${allocationCtes(userId, cost)},
      ${userDebitCte(userId, cost)},
      ledger AS (
        INSERT INTO credit_ledger (
          user_id, delta, reason, job_id, balance_after, bucket, lot_id, metadata
        )
        SELECT
          ${userId}::uuid,
          -ld.lot_take,
          ${input.reason}::credit_reason,
          NULL,
          ud.new_balance,
          ld.lot_class,
          ld.lot_id,
          ${meta}::jsonb || jsonb_build_object(
            'fromPromo',        ud.t_promo,
            'fromSubscription', ud.t_sub,
            'fromTopup',        ud.t_topup,
            'cost',             ${cost}::int
          )
        FROM lot_debit ld, user_debit ud
        RETURNING id
      )
    SELECT
      ud.new_balance AS credits_remaining,
      ud.t_promo     AS from_promo,
      ud.t_sub       AS from_sub,
      ud.t_topup     AS from_topup
    FROM user_debit ud
  `);
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  if (rows.length === 0) return null;
  const row = rows[0] as { credits_remaining: number; from_promo: number; from_sub: number; from_topup: number };
  return {
    creditsRemaining: row.credits_remaining,
    fromPromo: row.from_promo,
    fromSubscription: row.from_sub,
    fromTopup: row.from_topup,
  };
}
