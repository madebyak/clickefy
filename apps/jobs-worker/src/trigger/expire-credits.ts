/**
 * `expireCredits` — retire credit lots whose expiry has passed.
 *
 * Only top-up lots and subscription lots carry an expiry today; welcome
 * and admin credits are granted with `expires_at = NULL` and are never
 * touched here.
 *
 * A PAUSED lot is invisible to this sweep by construction: pausing clears
 * `expires_at` and parks the remaining life, and the
 * `credit_lots_pause_coherent` CHECK guarantees those two always move
 * together. So an unsubscribed user's top-ups cannot expire while they
 * are locked — which is the whole point of the pausing model.
 *
 * Runs daily rather than hourly on purpose. Expiry is not a
 * to-the-minute promise, a day of grace always favours the user, and one
 * pass a day keeps the ledger readable.
 *
 * Atomicity: one statement per user. Zeroing the lots, dropping the
 * projection and writing the ledger row happen together or not at all,
 * and the projection is decremented by exactly what the lots gave up, so
 * the `users_balance_matches_buckets` CHECK can never be tripped
 * mid-sweep.
 *
 * Idempotent: it only ever targets `expires_at < now() AND
 * amount_remaining > 0`, so a re-run the same day finds nothing.
 */

import { logger, schedules } from '@trigger.dev/sdk';
import { sql } from 'drizzle-orm';

import { getDb } from '../lib/db';

export const expireCredits = schedules.task({
  id: 'expire-credits',
  // 03:30 UTC — after the API Worker's 03:00 asset-retention cron, so the
  // two heavy daily passes don't overlap.
  cron: '30 3 * * *',
  maxDuration: 300,

  run: async () => {
    const db = getDb();

    // Which users have anything to expire. Doing this first keeps the
    // write below scoped to one user at a time, so a failure part-way
    // through leaves every already-processed user consistent rather than
    // half-sweeping the whole table.
    const due = await db.execute<{ user_id: string; expiring: number; lots: number }>(sql`
      SELECT user_id,
             SUM(amount_remaining)::int AS expiring,
             COUNT(*)::int              AS lots
      FROM credit_lots
      WHERE amount_remaining > 0
        AND expires_at IS NOT NULL
        AND expires_at < now()
      GROUP BY user_id
    `);
    const rows = (Array.isArray(due) ? due : ((due as { rows?: unknown[] }).rows ?? [])) as Array<{
      user_id: string;
      expiring: number;
      lots: number;
    }>;

    if (rows.length === 0) {
      return { users: 0, credits: 0, lots: 0 };
    }

    logger.info('expire-credits:found', {
      users: rows.length,
      credits: rows.reduce((n, r) => n + r.expiring, 0),
    });

    let users = 0;
    let credits = 0;
    let lots = 0;

    for (const r of rows) {
      try {
        const result = await db.execute<{ expired: number }>(sql`
          WITH
            -- Re-read inside the statement so a spend landing between the
            -- scan above and this write cannot over-subtract.
            doomed AS (
              SELECT id, class, amount_remaining
              FROM credit_lots
              WHERE user_id = ${r.user_id}::uuid
                AND amount_remaining > 0
                AND expires_at IS NOT NULL
                AND expires_at < now()
            ),
            totals AS (
              SELECT
                COALESCE(SUM(amount_remaining) FILTER (WHERE class = 'promo'), 0)::int        AS t_promo,
                COALESCE(SUM(amount_remaining) FILTER (WHERE class = 'subscription'), 0)::int AS t_sub,
                COALESCE(SUM(amount_remaining) FILTER (WHERE class = 'topup'), 0)::int        AS t_topup,
                COALESCE(SUM(amount_remaining), 0)::int                                       AS t_all,
                COUNT(*)::int                                                                 AS n_lots
              FROM doomed
            ),
            zeroed AS (
              UPDATE credit_lots cl
              SET amount_remaining = 0
              FROM doomed d
              WHERE cl.id = d.id
              RETURNING cl.id
            ),
            user_drop AS (
              UPDATE users u
              SET
                promo_credits        = u.promo_credits        - t.t_promo,
                subscription_credits = u.subscription_credits - t.t_sub,
                topup_credits        = u.topup_credits        - t.t_topup,
                credits_balance      = u.credits_balance      - t.t_all
              FROM totals t
              WHERE u.id = ${r.user_id}::uuid
                AND t.t_all > 0
                AND u.promo_credits        >= t.t_promo
                AND u.subscription_credits >= t.t_sub
                AND u.topup_credits        >= t.t_topup
                AND EXISTS (SELECT 1 FROM zeroed)
              RETURNING u.credits_balance AS new_balance
            ),
            entry AS (
              INSERT INTO credit_ledger (user_id, delta, reason, balance_after, bucket, note, metadata)
              SELECT
                ${r.user_id}::uuid, -t.t_all, 'admin_adjust'::credit_reason,
                ud.new_balance, NULL, 'credits expired',
                jsonb_build_object(
                  'expired', true,
                  'lots', t.n_lots,
                  'promo', t.t_promo, 'subscription', t.t_sub, 'topup', t.t_topup
                )
              FROM totals t, user_drop ud
              RETURNING id
            )
          SELECT t.t_all AS expired FROM totals t, user_drop ud
        `);
        const out = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{
          expired: number;
        }>;
        if (out.length > 0) {
          users += 1;
          credits += out[0]!.expired;
          lots += r.lots;
        }
      } catch (err) {
        // One user's failure must not abort the sweep — the next daily run
        // picks them up again, and nothing partial was written.
        logger.error('expire-credits:user-failed', {
          userId: r.user_id,
          err: String(err),
        });
      }
    }

    logger.info('expire-credits:done', { users, credits, lots });
    return { users, credits, lots };
  },
});
