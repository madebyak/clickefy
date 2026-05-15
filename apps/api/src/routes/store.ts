/**
 * `/v1/store` — public catalog of credit packs + subscription plans for
 * the mobile paywall.
 *
 * Two visibility modes:
 *   - Unauthenticated / free users: subscriptions only (top-up packs
 *     are gated behind an active subscription — see the credit-system
 *     plan for why).
 *   - Subscribed users: subscriptions (with "current plan" hint) AND
 *     top-up packs.
 *
 * Pricing is intentionally NOT included here. App Store / Play Store
 * is the source of truth for currency-localised prices; RevenueCat's
 * SDK surfaces them on the client via `priceString`. This endpoint
 * only supplies what the store can't: which products exist, what
 * credit amount they grant, and the operator's display intent
 * (featured, display_order).
 *
 * Auth: optional. `withCurrentUser()` is intentionally NOT used here
 * because it 401s when the caller is signed-out. We do an inline
 * lookup so the paywall renders for both signed-out (show subs only)
 * and signed-in (subs + packs if subscribed) flows.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';

import { creditPacks, subscriptionPlans, users } from '@clickfy/db';

import { withAuth } from '../middleware/with-auth';
import { byIp, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const storeRoute = new Hono<AppEnv>();

storeRoute.get(
  '/',
  withAuth({ required: false }),
  withRateLimit((env) => env.RL_USER_READ, byIp),
  async (c) => {
    const clerkId = c.get('clerkUserId');

    // Resolve to a Neon user row only if Clerk authed us. We avoid
    // the stub-create behaviour of `withCurrentUser()` because this
    // route is also public — anonymous callers must succeed without
    // ever touching the users table.
    const user = clerkId
      ? await c.var.db.query.users.findFirst({
          where: eq(users.clerkUserId, clerkId),
        })
      : null;

    const isSubscribed = !!user && user.entitlement !== 'free';

    const [packs, subs] = await Promise.all([
      isSubscribed
        ? c.var.db
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
            .orderBy(creditPacks.displayOrder, creditPacks.createdAt)
        : Promise.resolve([] as Array<unknown>),
      c.var.db
        .select({
          id: subscriptionPlans.id,
          storeProductId: subscriptionPlans.storeProductId,
          displayName: subscriptionPlans.displayName,
          entitlement: subscriptionPlans.entitlement,
          intervalUnit: subscriptionPlans.intervalUnit,
          intervalCount: subscriptionPlans.intervalCount,
          creditsPerPeriod: subscriptionPlans.creditsPerPeriod,
          displayOrder: subscriptionPlans.displayOrder,
          isFeatured: subscriptionPlans.isFeatured,
        })
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.isActive, true))
        .orderBy(subscriptionPlans.displayOrder, subscriptionPlans.createdAt),
    ]);

    return c.json({
      data: {
        subscriptions: subs,
        packs,
        topupsLocked: !isSubscribed,
        currentEntitlement: user?.entitlement ?? null,
      },
    });
  },
);
