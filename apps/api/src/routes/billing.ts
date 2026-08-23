/**
 * `/v1/billing` — the plan catalogue and, shortly, Stripe checkout.
 *
 * WHY THIS IS NOT `/v1/store`
 *   `/v1/store` is what the SHIPPED mobile app calls, and it serves the old
 *   `subscription_plans` rows. Reshaping it would break every installed
 *   build the moment this deploys. So the new catalogue lives here, and
 *   mobile moves over in Phase 3 on its own schedule.
 *
 * CROSS-PLATFORM STATE
 *   Neither Apple nor Stripe can see the other's subscriptions — only we
 *   can. So this endpoint is the only thing able to answer "is this person
 *   already subscribed, and where?", which is what stops someone paying
 *   twice for the same plan on two platforms.
 *
 *   `current.platform` tells the client where the subscription lives.
 *   When it is not the platform the client is running on, the client shows
 *   the plan as current and points the user at the right place to change
 *   it — Apple subscriptions can only be cancelled in iOS Settings, Stripe
 *   ones in the Customer Portal.
 *
 * Auth is OPTIONAL: a signed-out visitor must be able to read the pricing
 * page. `withCurrentUser()` is deliberately not used because it 401s.
 */

import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';

import { creditPacks, planProducts, plans, users } from '@clickfy/db';

import { withAuth } from '../middleware/with-auth';
import { byIp, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const billingRoute = new Hono<AppEnv>();

/** Free-tier allowance, shown on the pricing page. Read from the live
 *  grant policy so the marketing number cannot drift from what a new user
 *  is actually given. */
async function welcomeCredits(db: AppEnv['Variables']['db']): Promise<number> {
  const policy = await db.query.grantPolicies.findFirst({
    where: (gp, { and, eq: e }) => and(e(gp.kind, 'welcome'), e(gp.isActive, true)),
  });
  return policy?.amount ?? 0;
}

billingRoute.get(
  '/plans',
  withAuth({ required: false }),
  withRateLimit((env) => env.RL_PUBLIC_IP, byIp),
  async (c) => {
    const clerkId = c.get('clerkUserId');

    // Resolved inline rather than via `withCurrentUser()`, which 401s —
    // this route has to render for signed-out visitors.
    const user = clerkId
      ? await c.var.db.query.users.findFirst({ where: eq(users.clerkUserId, clerkId) })
      : null;

    const [rows, products, welcome] = await Promise.all([
      c.var.db
        .select()
        .from(plans)
        .where(eq(plans.isActive, true))
        .orderBy(asc(plans.displayOrder)),
      c.var.db.select().from(planProducts).where(eq(planProducts.isActive, true)),
      welcomeCredits(c.var.db),
    ]);

    const productsByPlan = new Map<string, Record<string, string>>();
    for (const p of products) {
      const entry = productsByPlan.get(p.planId) ?? {};
      entry[p.platform] = p.storeProductId;
      productsByPlan.set(p.planId, entry);
    }

    const catalogue = rows.map((p) => ({
      id: p.id,
      tier: p.tier,
      interval: p.interval,
      creditsPerPeriod: p.creditsPerPeriod,
      displayName: p.displayName,
      displayOrder: p.displayOrder,
      // Which storefronts can actually sell this today. Empty means the
      // products have not been created yet — the pricing page must not
      // offer a buy button for something no storefront knows about.
      products: productsByPlan.get(p.id) ?? {},
    }));

    const isSubscribed = !!user && user.entitlement !== 'free' && user.entitlement !== 'admin';

    // Top-up packs stay gated behind an active subscription — the rule that
    // guarantees nobody buys credits they cannot spend.
    const packs = isSubscribed
      ? await c.var.db
          .select({
            id: creditPacks.id,
            storeProductId: creditPacks.storeProductId,
            displayName: creditPacks.displayName,
            credits: creditPacks.credits,
            bonusCredits: creditPacks.bonusCredits,
            displayOrder: creditPacks.displayOrder,
            isFeatured: creditPacks.isFeatured,
          })
          .from(creditPacks)
          .where(eq(creditPacks.isActive, true))
          .orderBy(asc(creditPacks.displayOrder))
      : [];

    return c.json({
      data: {
        plans: catalogue,
        /** What a brand-new account is given, straight from the live policy. */
        freeCredits: welcome,
        /**
         * The user's live subscription, or null. `platform` is the field
         * that prevents double-billing: a client running somewhere else
         * must show this as current rather than offering it for sale.
         */
        current: isSubscribed
          ? {
              tier: user!.entitlement,
              platform: user!.subscriptionPlatform ?? null,
              productId: user!.subscriptionProductId ?? null,
              expiresAt: user!.subscriptionExpiresAt?.toISOString() ?? null,
            }
          : null,
        entitlement: user?.entitlement ?? null,
        packs,
        topupsLocked: !isSubscribed,
      },
    });
  },
);
