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
import { and, asc, eq } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { creditPacks, planProducts, plans, users } from '@clickfy/db';

import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, byIp, withRateLimit } from '../middleware/with-rate-limit';
import { makeStripe } from '../lib/stripe-client';
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

// ─── Checkout ───────────────────────────────────────────────────────

const checkoutSchema = z
  .object({
    planId: z.string().uuid(),
    /** Where to send the customer back to. Validated against our own origin. */
    successPath: z.string().max(200).optional(),
    cancelPath: z.string().max(200).optional(),
  })
  .strict();

/**
 * Only ever redirect back to our own site. An open redirect on a payment
 * flow is a phishing primitive — "pay here, then get sent to a page that
 * looks like us and asks for your card again".
 */
function safeReturnUrl(origin: string, path: string | undefined, fallback: string): string {
  const p = path && path.startsWith('/') && !path.startsWith('//') ? path : fallback;
  return `${origin}${p}`;
}

billingRoute.post(
  '/checkout',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  zValidator('json', checkoutSchema),
  async (c) => {
    const user = c.var.user!;
    const { planId, successPath, cancelPath } = c.req.valid('json');

    if (!c.env.STRIPE_SECRET_KEY) {
      return c.json(
        { error: { code: 'stripe_unconfigured', message: 'Payments are not configured.' } },
        503,
      );
    }

    // Someone already subscribed through a store cannot be sold to here.
    // Stripe cannot see or replace an Apple subscription, so charging them
    // would simply bill them twice for the same thing.
    if (
      user.subscriptionPlatform === 'app_store' ||
      user.subscriptionPlatform === 'play_store'
    ) {
      return c.json(
        {
          error: {
            code: 'subscribed_elsewhere',
            message:
              'You already subscribe through the mobile app. Manage or change your plan there.',
            details: { platform: user.subscriptionPlatform },
          },
        },
        409,
      );
    }

    const plan = await c.var.db.query.plans.findFirst({
      where: and(eq(plans.id, planId), eq(plans.isActive, true)),
    });
    if (!plan) {
      return c.json({ error: { code: 'plan_not_found', message: 'Plan not found.' } }, 404);
    }

    const product = await c.var.db.query.planProducts.findFirst({
      where: and(
        eq(planProducts.planId, planId),
        eq(planProducts.platform, 'stripe'),
        eq(planProducts.isActive, true),
      ),
    });
    if (!product) {
      // The plan exists but has no Stripe price yet. Refuse rather than
      // improvise — a checkout built on a guessed price id is how someone
      // gets charged the wrong amount.
      return c.json(
        {
          error: {
            code: 'plan_not_purchasable',
            message: 'This plan is not available for purchase yet.',
          },
        },
        409,
      );
    }

    const stripe = makeStripe(c.env.STRIPE_SECRET_KEY);
    const origin = new URL(c.req.url).origin;

    // Reuse the customer if we have one, so a returning subscriber keeps a
    // single Stripe identity and one billing history.
    let customerId = user.stripeCustomerId ?? undefined;
    if (!customerId) {
      const created = await stripe.customers.create({
        email: user.email,
        name: user.name ?? undefined,
        metadata: { clickefy_user_id: user.id },
      });
      customerId = created.id;
      await c.var.db
        .update(users)
        .set({ stripeCustomerId: customerId })
        .where(eq(users.id, user.id));
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: product.storeProductId, quantity: 1 }],
        // Belt and braces for attribution: the webhook resolves the user
        // from the customer id, but if a customer record is ever recreated
        // this is a second way home.
        client_reference_id: user.id,
        subscription_data: {
          metadata: {
            clickefy_user_id: user.id,
            clickefy_plan_id: plan.id,
            clickefy_tier: plan.tier,
          },
        },
        success_url: safeReturnUrl(
          c.req.header('origin') ?? origin,
          successPath,
          '/billing/success?session={CHECKOUT_SESSION_ID}',
        ),
        cancel_url: safeReturnUrl(c.req.header('origin') ?? origin, cancelPath, '/#pricing'),
        allow_promotion_codes: true,
      },
      {
        // Stripe-level idempotency: a double-clicked button creates ONE
        // session rather than two, so the customer cannot end up with two
        // half-finished checkouts.
        idempotencyKey: `checkout:${user.id}:${plan.id}:${Math.floor(Date.now() / 60_000)}`,
      },
    );

    return c.json({ data: { url: session.url, sessionId: session.id } });
  },
);

// ─── Customer portal ────────────────────────────────────────────────

/**
 * Stripe's hosted portal handles cancellation, plan changes, card updates
 * and invoice history. Building those ourselves would mean reimplementing
 * proration and dunning UI that Stripe already gets right.
 */
billingRoute.post(
  '/portal',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const user = c.var.user!;
    if (!c.env.STRIPE_SECRET_KEY) {
      return c.json(
        { error: { code: 'stripe_unconfigured', message: 'Payments are not configured.' } },
        503,
      );
    }
    if (!user.stripeCustomerId) {
      return c.json(
        {
          error: {
            code: 'no_stripe_customer',
            message: 'There is no web billing account for this user.',
          },
        },
        404,
      );
    }

    const stripe = makeStripe(c.env.STRIPE_SECRET_KEY);
    const origin = c.req.header('origin') ?? new URL(c.req.url).origin;
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${origin}/settings`,
    });

    return c.json({ data: { url: session.url } });
  },
);
