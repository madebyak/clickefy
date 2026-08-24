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

import {
  creditPacks,
  packProducts,
  planProducts,
  plans,
  providerModels,
  users,
} from '@clickfy/db';

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

/**
 * The model line-up, shaped for the public pricing table.
 *
 * The pricing page turns credits into something people can picture — "how
 * many videos does 4,500 credits actually buy me?" — which only works if
 * these numbers are the SAME ones the job route charges. So they come
 * from `provider_models`, never from a constant in the web app.
 *
 * Three deliberate exclusions:
 *   - `deprecated` models: still in the table so old jobs render, but
 *     nobody should be choosing one from a pricing page.
 *   - unpriced models (`cost_credits = 0`): dividing by zero would
 *     advertise unlimited generations, which is the single worst number
 *     to get wrong on a page where people are deciding whether to pay.
 *   - `cost_per_call_usd`: that is what the PROVIDER charges us. It is
 *     margin data and has no business leaving the server.
 *
 * The price quoted is the model's DEFAULT quality and, for video, its
 * default clip length — the cost of pressing Generate without changing a
 * setting. Anything else would quote a number most people never pay.
 */
function marketingModels(rows: Array<typeof providerModels.$inferSelect>) {
  return rows
    .filter((m) => m.status !== 'deprecated' && m.costCredits > 0)
    .map((m) => {
      const caps = m.capabilities as Record<string, unknown>;
      const kind = caps.kind === 'video' ? 'video' : 'image';

      // `modes` carries the quality tiers. The default key is what we
      // price at; `labels` maps an internal key like `std` to what a
      // customer would recognise ("720p").
      const modes = (caps.modes ?? null) as {
        default?: string;
        labels?: Record<string, string>;
      } | null;
      const defaultMode = modes?.default ?? null;
      const quality = defaultMode ? (modes?.labels?.[defaultMode] ?? defaultMode) : null;

      const duration = (caps.duration ?? null) as { default?: number } | null;

      return {
        key: m.modelKey,
        name: m.displayName,
        kind,
        /** Credits for one generation at the default quality and length. */
        credits: m.costCredits,
        quality,
        /** Clip length the price is quoted at. Null for images. */
        seconds: kind === 'video' ? (duration?.default ?? null) : null,
        /** Not yet general release — worth marking rather than hiding. */
        preview: m.status === 'preview',
      };
    })
    // Images first, then video; cheapest first within each. Reads as a
    // ladder rather than an inventory.
    .sort((a, b) =>
      a.kind === b.kind ? a.credits - b.credits : a.kind === 'image' ? -1 : 1,
    );
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

    const [rows, products, welcome, models] = await Promise.all([
      c.var.db
        .select()
        .from(plans)
        .where(eq(plans.isActive, true))
        .orderBy(asc(plans.displayOrder)),
      c.var.db.select().from(planProducts).where(eq(planProducts.isActive, true)),
      welcomeCredits(c.var.db),
      c.var.db.select().from(providerModels),
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

    // The pack CATALOGUE is public. Buying is still gated on an active
    // subscription (`topupsLocked`), but hiding the packs from everyone
    // who has not subscribed yet — which is what this used to do — means
    // the pricing page cannot show what a subscription unlocks. Better to
    // show the ladder with a "subscribe first" CTA than to pretend it
    // does not exist.
    //
    // `/v1/store` keeps its own stricter behaviour for the shipped mobile
    // app; this is the web catalogue and answers a different question.
    const packRows = await c.var.db
      .select({
        id: creditPacks.id,
        storeProductId: creditPacks.storeProductId,
        displayName: creditPacks.displayName,
        credits: creditPacks.credits,
        bonusCredits: creditPacks.bonusCredits,
        displayOrder: creditPacks.displayOrder,
        isFeatured: creditPacks.isFeatured,
        priceUsd: packProducts.priceUsd,
        stripeProductId: packProducts.storeProductId,
      })
      .from(creditPacks)
      .leftJoin(
        packProducts,
        and(
          eq(packProducts.packId, creditPacks.id),
          eq(packProducts.platform, 'stripe'),
          eq(packProducts.isActive, true),
        ),
      )
      .where(eq(creditPacks.isActive, true))
      .orderBy(asc(creditPacks.displayOrder));

    const packs = packRows.map((p) => ({
      id: p.id,
      storeProductId: p.storeProductId,
      displayName: p.displayName,
      credits: p.credits,
      bonusCredits: p.bonusCredits,
      /** What the customer actually receives — the number to show. */
      totalCredits: p.credits + p.bonusCredits,
      displayOrder: p.displayOrder,
      isFeatured: p.isFeatured,
      /** Web price. Null means no Stripe price exists yet. */
      priceUsd: p.priceUsd != null ? Number(p.priceUsd) : null,
      /** A pack with no Stripe price cannot be bought, however much the
       *  catalogue would like it to be. */
      purchasable: p.stripeProductId != null,
    }));

    return c.json({
      data: {
        plans: catalogue,
        /** What a brand-new account is given, straight from the live policy. */
        freeCredits: welcome,
        /**
         * Every sellable model with its real credit price, so the pricing
         * page can show what each plan actually buys instead of asking
         * people to do the division themselves.
         */
        models: marketingModels(models),
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

// ─── Top-up checkout ────────────────────────────────────────────────

const topupSchema = z
  .object({
    packId: z.string().uuid(),
    successPath: z.string().max(200).optional(),
    cancelPath: z.string().max(200).optional(),
  })
  .strict();

/**
 * `POST /v1/billing/topup` — buy a credit pack.
 *
 * A SEPARATE ROUTE from `/checkout`, not a branch inside it, because
 * almost everything differs: the Stripe mode, the eligibility rule, the
 * metadata, and the webhook event that eventually grants. Folding them
 * together would mean one handler where half the branches are wrong for
 * whichever request is in flight.
 *
 * `mode: 'payment'` is load-bearing. A credit pack is a one-time
 * purchase; `mode: 'subscription'` here would silently enrol the customer
 * in a monthly charge for what they believed was a single top-up.
 *
 * THE SUBSCRIPTION GATE is the rule that makes top-ups safe to sell:
 * top-up credits can only be SPENT while subscribed (see the allocator's
 * `class <> 'topup' OR is_subscribed` guard), so selling them to someone
 * without a subscription would be selling credits they cannot use. The
 * gate is deliberately platform-agnostic — an iOS subscriber buying a
 * top-up here is fine and cannot be double-billed, because a one-time
 * purchase has nothing to collide with.
 */
billingRoute.post(
  '/topup',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  zValidator('json', topupSchema),
  async (c) => {
    const user = c.var.user!;
    const { packId, successPath, cancelPath } = c.req.valid('json');

    if (!c.env.STRIPE_SECRET_KEY) {
      return c.json(
        { error: { code: 'stripe_unconfigured', message: 'Payments are not configured.' } },
        503,
      );
    }

    // Selling credits that cannot be spent is the one outcome worth a
    // hard 409 here. `admin` is excluded alongside `free` deliberately:
    // an admin account is not a paying subscription.
    const isSubscribed = user.entitlement !== 'free' && user.entitlement !== 'admin';
    if (!isSubscribed) {
      return c.json(
        {
          error: {
            code: 'topup_requires_subscription',
            message: 'Credit packs are available on any paid plan. Subscribe first.',
          },
        },
        409,
      );
    }

    const pack = await c.var.db.query.creditPacks.findFirst({
      where: and(eq(creditPacks.id, packId), eq(creditPacks.isActive, true)),
    });
    if (!pack) {
      return c.json({ error: { code: 'pack_not_found', message: 'Pack not found.' } }, 404);
    }

    const product = await c.var.db.query.packProducts.findFirst({
      where: and(
        eq(packProducts.packId, packId),
        eq(packProducts.platform, 'stripe'),
        eq(packProducts.isActive, true),
      ),
    });
    if (!product) {
      // No Stripe price yet. Refuse rather than improvise — a checkout
      // built on a guessed price id charges the wrong amount.
      return c.json(
        {
          error: {
            code: 'pack_not_purchasable',
            message: 'This pack is not available for purchase yet.',
          },
        },
        409,
      );
    }

    const stripe = makeStripe(c.env.STRIPE_SECRET_KEY);
    const origin = new URL(c.req.url).origin;

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
        mode: 'payment',
        customer: customerId,
        line_items: [{ price: product.storeProductId, quantity: 1 }],
        client_reference_id: user.id,
        // The webhook grants from the PACK ROW, looked up by this id — it
        // never trusts a credit amount carried in metadata. Amounts in
        // metadata are a copy of the truth, and a copy can be stale if a
        // pack is re-credited between checkout and payment.
        payment_intent_data: {
          metadata: {
            clickefy_user_id: user.id,
            clickefy_pack_id: pack.id,
            clickefy_kind: 'topup',
          },
        },
        metadata: {
          clickefy_user_id: user.id,
          clickefy_pack_id: pack.id,
          clickefy_kind: 'topup',
        },
        success_url: safeReturnUrl(
          c.req.header('origin') ?? origin,
          successPath,
          '/billing/success?topup=1',
        ),
        cancel_url: safeReturnUrl(c.req.header('origin') ?? origin, cancelPath, '/#pricing'),
        allow_promotion_codes: true,
      },
      {
        idempotencyKey: `topup:${user.id}:${pack.id}:${Math.floor(Date.now() / 60_000)}`,
      },
    );

    return c.json({ data: { url: session.url, sessionId: session.id } });
  },
);
