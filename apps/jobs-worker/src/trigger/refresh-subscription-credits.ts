/**
 * `refreshSubscriptionCredits` — top a subscriber back up every 30 days,
 * regardless of how often they are BILLED.
 *
 * WHY THIS HAS TO EXIST
 *   A yearly plan bills once a year, so Stripe and RevenueCat send a
 *   renewal event once a year. If the credit grant rode on that event
 *   alone, an annual Ultimate subscriber would receive twelve months'
 *   allowance — 150,000 credits — on day one.
 *
 *   That is not a theoretical worry. It invites burning the whole year's
 *   allowance in the first month, which converts a comfortable 58% margin
 *   into one very expensive month with eleven unpaid ones behind it. Every
 *   comparable product avoids it the same way: Higgsfield grants "on
 *   annual plans every 30 days".
 *
 *   So the allowance is per 30 DAYS on every plan, and this task supplies
 *   the eleven refreshes a year that no webhook will ever announce.
 *
 * HOW A REFRESH IS DECIDED
 *   A subscriber is due when their newest subscription lot is older than
 *   30 days and their subscription has not expired. Monthly subscribers
 *   are normally topped up by their own renewal webhook well before that,
 *   so in practice this only fires for annual plans — but it is written
 *   against the DATA rather than the interval, so a missed or delayed
 *   monthly webhook is quietly repaired too. That is a useful property to
 *   have for free.
 *
 * SAFETY
 *   - Use-it-or-lose-it is preserved: the previous lot is closed before
 *     the new one opens, exactly as a renewal does.
 *   - `source_ref` is the 30-day period key, so the unique index makes a
 *     double run within one period impossible even if the schedule fires
 *     twice or a retry lands.
 *   - One user per statement; a failure leaves everyone already processed
 *     consistent and the next run picks the rest up.
 */

import { logger, schedules } from '@trigger.dev/sdk';
import { and, eq, sql } from 'drizzle-orm';

import { plans, type PlanTier } from '@clickfy/db';

import { getDb } from '../lib/db';

/** The allowance period. Every plan grants its credits once per window. */
const REFRESH_WINDOW_DAYS = 30;

/** The sellable tiers. Anything else on a user row is a data problem. */
const TIERS: readonly PlanTier[] = ['basic', 'creator', 'pro', 'ultimate'];

export const refreshSubscriptionCredits = schedules.task({
  id: 'refresh-subscription-credits',
  // 04:00 UTC, after the expiry sweep at 03:30 — so a lot that expires
  // today is retired before we decide whether the user is due a new one.
  cron: '0 4 * * *',
  maxDuration: 600,

  run: async () => {
    const db = getDb();

    // Who is due: an active paid subscriber whose newest subscription lot
    // is older than the window (or who has none at all).
    const due = await db.execute<{
      user_id: string;
      entitlement: string;
      product_id: string | null;
      newest_lot: string | null;
    }>(sql`
      SELECT
        u.id AS user_id,
        u.entitlement::text AS entitlement,
        u.subscription_product_id AS product_id,
        MAX(cl.created_at)::text AS newest_lot
      FROM users u
      LEFT JOIN credit_lots cl
        ON cl.user_id = u.id AND cl.class = 'subscription'
      WHERE u.is_deleted = false
        AND u.entitlement NOT IN ('free', 'admin')
        -- Still inside a paid period. A lapsed subscriber is handled by
        -- the expiry path, not topped up here.
        AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at > now())
      GROUP BY u.id, u.entitlement, u.subscription_product_id
      HAVING MAX(cl.created_at) IS NULL
          OR MAX(cl.created_at) < now() - (${REFRESH_WINDOW_DAYS} || ' days')::interval
    `);
    const rows = (Array.isArray(due) ? due : ((due as { rows?: unknown[] }).rows ?? [])) as Array<{
      user_id: string;
      entitlement: string;
      product_id: string | null;
      newest_lot: string | null;
    }>;

    if (rows.length === 0) return { refreshed: 0, credits: 0 };

    logger.info('refresh-subscription-credits:due', { users: rows.length });

    let refreshed = 0;
    let credits = 0;

    for (const r of rows) {
      try {
        // The allowance comes from the plan matching their tier. Monthly
        // and yearly rows carry the SAME per-period amount, so either
        // answers the question.
        //
        // Narrowed explicitly rather than cast: an entitlement that is not
        // a sellable tier means the catalogue and the user row disagree,
        // which deserves a warning rather than a silent skip.
        const tier = r.entitlement as PlanTier;
        const plan = TIERS.includes(tier)
          ? await db.query.plans.findFirst({
              where: and(eq(plans.tier, tier), eq(plans.isActive, true)),
            })
          : undefined;
        if (!plan) {
          logger.warn('refresh-subscription-credits:no-plan', {
            userId: r.user_id,
            entitlement: r.entitlement,
          });
          continue;
        }

        // The period this refresh belongs to. Stable within the window, so
        // the lot's unique index rejects a second attempt outright.
        const periodKey = Math.floor(Date.now() / (REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000));
        const sourceRef = `refresh:${periodKey}`;
        const expiresAt = new Date(Date.now() + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000);

        const result = await db.execute<{ granted: number }>(sql`
          WITH
            -- Use-it-or-lose-it, exactly as a renewal does.
            outstanding AS (
              SELECT COALESCE(SUM(amount_remaining), 0)::int AS unspent
              FROM credit_lots
              WHERE user_id = ${r.user_id}::uuid
                AND class = 'subscription'
                AND amount_remaining > 0
            ),
            new_lot AS (
              INSERT INTO credit_lots (
                user_id, class, kind, amount_granted, amount_remaining,
                expires_at, source_platform, source_ref
              )
              VALUES (
                ${r.user_id}::uuid, 'subscription', 'subscription',
                ${plan.creditsPerPeriod}::int, ${plan.creditsPerPeriod}::int,
                ${expiresAt.toISOString()}::timestamptz, 'system', ${sourceRef}
              )
              ON CONFLICT (user_id, kind, source_ref) WHERE source_ref IS NOT NULL
              DO NOTHING
              RETURNING id, amount_granted
            ),
            -- Close the previous allowance ONLY if a new one was actually
            -- issued. Gating this on new_lot is load-bearing: on a second
            -- run inside the same period the insert conflicts and returns
            -- nothing, and an ungated close would zero the user's CURRENT
            -- lots while the projection still showed the credits — silently
            -- destroying them. The new lot is invisible here (data-modifying
            -- CTEs do not see each other's writes), so only the previous
            -- period's lots are touched.
            closed AS (
              UPDATE credit_lots
              SET amount_remaining = 0
              WHERE user_id = ${r.user_id}::uuid
                AND class = 'subscription'
                AND amount_remaining > 0
                AND EXISTS (SELECT 1 FROM new_lot)
              RETURNING id
            ),
            bumped AS (
              UPDATE users u
              SET
                subscription_credits = ${plan.creditsPerPeriod}::int,
                credits_balance      = u.credits_balance - o.unspent + ${plan.creditsPerPeriod}::int
              FROM outstanding o, new_lot nl
              WHERE u.id = ${r.user_id}::uuid
              RETURNING u.credits_balance AS new_balance
            ),
            forfeit_entry AS (
              INSERT INTO credit_ledger (user_id, delta, reason, balance_after, bucket, metadata)
              SELECT ${r.user_id}::uuid, -o.unspent, 'subscription_reset'::credit_reason,
                     b.new_balance - ${plan.creditsPerPeriod}::int, 'subscription',
                     jsonb_build_object('periodicRefresh', true)
              FROM outstanding o, bumped b, new_lot nl
              WHERE o.unspent > 0
              RETURNING id
            ),
            grant_entry AS (
              INSERT INTO credit_ledger (user_id, delta, reason, balance_after, bucket, lot_id, note, metadata)
              SELECT ${r.user_id}::uuid, nl.amount_granted, 'subscription_grant'::credit_reason,
                     b.new_balance, 'subscription', nl.id,
                     '30-day allowance refresh',
                     jsonb_build_object('periodicRefresh', true, 'tier', ${r.entitlement})
              FROM new_lot nl, bumped b
              RETURNING id
            )
          SELECT nl.amount_granted AS granted FROM new_lot nl
        `);
        const out = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{
          granted: number;
        }>;
        if (out.length > 0) {
          refreshed += 1;
          credits += out[0]!.granted;
        }
      } catch (err) {
        logger.error('refresh-subscription-credits:user-failed', {
          userId: r.user_id,
          err: String(err),
        });
      }
    }

    logger.info('refresh-subscription-credits:done', { refreshed, credits });
    return { refreshed, credits };
  },
});
