/**
 * `/v1/admin/billing` — who is paying us, and how much.
 *
 * WHY THIS IS SPLIT BY PLATFORM FROM DAY ONE
 *   A subscription bought on the web lives in Stripe; one bought in the
 *   iOS app lives in Apple's world and reaches us through RevenueCat. They
 *   renew differently, they are cancelled in different places, they are
 *   refunded by different companies, and only one of them can be changed
 *   by us. A single "subscribers" list that blurred the two would be wrong
 *   the first time someone tried to act on a row.
 *
 *   Mobile is not live yet. The split exists anyway, because retrofitting
 *   it after the fact means every number in the admin UI has to be
 *   re-checked for which world it was counting.
 *
 * WHY MRR IS COMPUTED HERE AND NOT READ FROM STRIPE
 *   Stripe's own MRR only knows about Stripe. Ours has to include mobile
 *   eventually, and it has to count a comped plan as zero rather than as
 *   the price nobody paid. The plan catalogue is the one place that knows
 *   what each tier costs on each storefront, so the arithmetic belongs
 *   next to it.
 */

import { Hono } from 'hono';
import { and, desc, eq, ne, sql } from 'drizzle-orm';

import { planProducts, plans, users } from '@clickfy/db';

import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const adminBillingRoute = new Hono<AppEnv>();

// Gated on the `credits` page rather than a new `billing` key: the two
// answer the same question from different ends, and anyone trusted with
// the credit catalogue is trusted with the revenue it produces. A new key
// would mean a permissions migration for no change in who may look.
adminBillingRoute.use(
  '*',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'credits' }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
);

/**
 * Where a paid entitlement came from.
 *
 * `comped` is its own answer rather than "unknown": a plan granted by an
 * admin has no storefront, no renewal and no money, and showing it beside
 * paying customers without saying so would overstate revenue.
 */
type Source = 'stripe' | 'app_store' | 'play_store' | 'comped';

adminBillingRoute.get('/subscribers', async (c) => {
  const rows = await c.var.db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      entitlement: users.entitlement,
      platform: users.subscriptionPlatform,
      productId: users.subscriptionProductId,
      renewsAt: users.subscriptionRenewsAt,
      expiresAt: users.subscriptionExpiresAt,
      credits: users.creditsBalance,
      stripeCustomerId: users.stripeCustomerId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      and(
        eq(users.isDeleted, false),
        ne(users.entitlement, 'free'),
        // `admin` is a staff role, not a plan, and counting it as revenue
        // would be flattering nonsense.
        ne(users.entitlement, 'admin'),
      ),
    )
    .orderBy(desc(users.subscriptionExpiresAt))
    .limit(500);

  // Monthly value per storefront price, so a yearly plan counts as a
  // twelfth of itself rather than as a spike in the month it was sold.
  const products = await c.var.db
    .select({
      priceId: planProducts.storeProductId,
      platform: planProducts.platform,
      priceUsd: planProducts.priceUsd,
      interval: plans.interval,
      tier: plans.tier,
    })
    .from(planProducts)
    .innerJoin(plans, eq(plans.id, planProducts.planId));
  const monthlyValue = new Map<string, number>();
  for (const p of products) {
    if (p.priceUsd == null) continue;
    monthlyValue.set(p.priceId, Number(p.priceUsd) / (p.interval === 'year' ? 12 : 1));
  }

  const subscribers = rows.map((r) => {
    const source: Source = (r.platform as Source) ?? 'comped';
    const mrr = source === 'comped' ? 0 : (r.productId ? (monthlyValue.get(r.productId) ?? 0) : 0);
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      tier: r.entitlement,
      source,
      productId: r.productId,
      renewsAt: r.renewsAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      credits: r.credits,
      /** Present only for Stripe: the id to look up in their dashboard. */
      stripeCustomerId: source === 'stripe' ? r.stripeCustomerId : null,
      /** This subscriber's contribution to monthly revenue, in USD. */
      mrrUsd: Math.round(mrr * 100) / 100,
      since: r.createdAt.toISOString(),
    };
  });

  const bySource = subscribers.reduce<Record<string, { count: number; mrrUsd: number }>>((acc, s) => {
    const cell = (acc[s.source] ??= { count: 0, mrrUsd: 0 });
    cell.count += 1;
    cell.mrrUsd = Math.round((cell.mrrUsd + s.mrrUsd) * 100) / 100;
    return acc;
  }, {});

  const byTier = subscribers.reduce<Record<string, number>>((acc, s) => {
    acc[s.tier] = (acc[s.tier] ?? 0) + 1;
    return acc;
  }, {});

  return c.json({
    data: {
      subscribers,
      summary: {
        total: subscribers.length,
        bySource,
        byTier,
        mrrUsd:
          Math.round(subscribers.reduce((n, s) => n + s.mrrUsd, 0) * 100) / 100,
      },
    },
  });
});

/**
 * Recent credit movement with money behind it.
 *
 * Deliberately not the whole ledger: job charges are the noisy majority
 * and answer a different question. This is "what did we sell, and what
 * did we give away", which is what someone opening a billing screen is
 * actually asking.
 */
adminBillingRoute.get('/activity', async (c) => {
  const rows = await c.var.db.execute<{
    created_at: string;
    email: string;
    delta: number;
    reason: string;
    note: string | null;
    source_platform: string | null;
  }>(sql`
    SELECT cl.created_at::text, u.email, cl.delta, cl.reason::text, cl.note,
           lot.source_platform
    FROM credit_ledger cl
    JOIN users u ON u.id = cl.user_id
    LEFT JOIN credit_lots lot ON lot.id = cl.lot_id
    WHERE cl.reason IN ('purchase', 'subscription_grant', 'subscription_reset', 'refund', 'admin_adjust')
    ORDER BY cl.created_at DESC
    LIMIT 100
  `);
  const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as Array<{
    created_at: string;
    email: string;
    delta: number;
    reason: string;
    note: string | null;
    source_platform: string | null;
  }>;
  return c.json({ data: { activity: list } });
});
