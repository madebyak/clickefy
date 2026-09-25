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
import type Stripe from 'stripe';
import { and, asc, eq } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { isSelfServePlanChange, type PlanInterval, type UserEntitlement } from '@clickfy/types';

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
import { isToolOnlyModel } from '../lib/create-models';
import { makeStripe } from '../lib/stripe-client';
import {
  cancelPendingChange,
  changePlan,
  currentPeriodEnd,
  currentPriceId,
  findLiveSubscription,
  pendingPriceChange,
  subscriptionEndsAt,
} from '../lib/stripe-subscription';
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
 * Four deliberate exclusions:
 *   - `deprecated` models: still in the table so old jobs render, but
 *     nobody should be choosing one from a pricing page.
 *   - TOOL-ONLY models: the Video Upscaler is real and priced, but this
 *     table answers "how many images and videos does this plan buy?"
 *     and it makes neither — it takes a clip you already have. Listed
 *     between Nano Banana and Kling it read as "a video for 1 credit",
 *     which is three different kinds of wrong at once. The roster in
 *     `create-models.ts` is where that fact lives; this is its third
 *     consumer after the picker and `/v1/models`.
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
    .filter((m) => m.status !== 'deprecated' && m.costCredits > 0 && !isToolOnlyModel(m.modelKey))
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
    // List prices per storefront, from the same rows. The web pricing
    // page used to hardcode these in a constant — the one number a
    // customer will hold us to, kept in a file nobody re-reads when the
    // Stripe price changes. Now it reads what `sync-stripe-prices` wrote.
    const pricesByPlan = new Map<string, Record<string, number>>();
    for (const p of products) {
      const entry = productsByPlan.get(p.planId) ?? {};
      entry[p.platform] = p.storeProductId;
      productsByPlan.set(p.planId, entry);
      if (p.priceUsd != null) {
        const prices = pricesByPlan.get(p.planId) ?? {};
        prices[p.platform] = Number(p.priceUsd);
        pricesByPlan.set(p.planId, prices);
      }
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
      /** USD list price per storefront. Absent = no price recorded yet. */
      prices: pricesByPlan.get(p.id) ?? {},
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
              /**
               * Monthly or yearly, so the pricing page can route a yearly
               * subscriber to support instead of offering a change the API
               * will refuse. Null for a comp (no storefront product).
               */
              interval:
                rows.find((p) => productsByPlan.get(p.id)?.[user!.subscriptionPlatform ?? ''] === user!.subscriptionProductId)
                  ?.interval ?? null,
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

/**
 * The customer id to bill, creating one if we have none — and recreating
 * one if the id we hold no longer resolves.
 *
 * THE CASE THIS EXISTS FOR: a `cus_…` created in Stripe's test sandbox
 * does not exist in live mode. Two production accounts carry exactly
 * that, from sandbox purchases made before go-live, and without this the
 * first thing either of them sees on the new keys is a 500 from Stripe.
 * The same failure appears any time a customer is deleted in the
 * dashboard, which is an ordinary thing for someone to do.
 *
 * Recreating is safe: a customer record holds no money, only an identity
 * and its history. The worst case is a returning subscriber whose old
 * invoices sit under a previous customer — far better than a billing page
 * that cannot open.
 */
async function ensureStripeCustomer(
  stripe: Stripe,
  db: AppEnv['Variables']['db'],
  user: NonNullable<AppEnv['Variables']['user']>,
): Promise<string> {
  const create = async () => {
    const created = await stripe.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { clickefy_user_id: user.id },
    });
    await db.update(users).set({ stripeCustomerId: created.id }).where(eq(users.id, user.id));
    return created.id;
  };

  if (!user.stripeCustomerId) return create();

  try {
    const existing = await stripe.customers.retrieve(user.stripeCustomerId);
    // A DELETED customer comes back as an object rather than an error, and
    // billing against it fails later with a much less obvious message.
    if (!existing.deleted) return user.stripeCustomerId;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const status = (err as { statusCode?: number })?.statusCode;
    if (code !== 'resource_missing' && status !== 404) throw err;
  }

  console.warn('[billing] stripe customer no longer resolves, recreating', {
    userId: user.id,
    stale: user.stripeCustomerId,
  });
  return create();
}

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
 *
 * The ORIGIN comes from configuration, never from the request. It used to
 * be read from the `Origin` header, which is chosen by whoever is calling
 * us: the path was validated but the host was not, so the one part that
 * decides which site the customer lands on was the part we did not
 * control. `WEB_APP_URL` is ours and cannot be talked out of us.
 */
function safeReturnUrl(env: AppEnv['Bindings'], path: string | undefined, fallback: string): string {
  const origin = (env.WEB_APP_URL ?? 'https://clickefy.ai').replace(/\/+$/, '');
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

    // ── One subscription per customer ────────────────────────────────
    //
    // Stripe will happily give a customer a second subscription, bill
    // both, and never mention it. Somebody who already pays and clicks a
    // plan card again — because they forgot, or because they meant to
    // change tier, or because they cancelled and want back in — must not
    // end up paying twice.
    //
    // Stripe is asked rather than our own columns: a subscription started
    // in the portal, or cancelled there, is real long before the webhook
    // telling us about it arrives.
    if (user.stripeCustomerId) {
      const stripeForCheck = makeStripe(c.env.STRIPE_SECRET_KEY);
      const existing = await findLiveSubscription(stripeForCheck, user.stripeCustomerId);
      if (existing) {
        const currentPrice = currentPriceId(existing);
        // Either of Stripe's two cancellation spellings — see
        // `subscriptionEndsAt`. A plan cancelled in the portal is "ending"
        // exactly as much as one cancelled here.
        const ending = subscriptionEndsAt(existing) != null;
        return c.json(
          {
            error: {
              code: 'already_subscribed',
              message: ending
                ? 'Your plan is set to end. Resume it instead of subscribing again.'
                : 'You already have a subscription. Change your plan instead.',
              details: {
                subscriptionId: existing.id,
                currentPriceId: currentPrice,
                cancelAtPeriodEnd: ending,
                /** What the client should do: resume, or change plan. */
                action: ending ? 'resume' : 'change_plan',
              },
            },
          },
          409,
        );
      }
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

    // Reuse the customer if we have one, so a returning subscriber keeps a
    // single Stripe identity and one billing history.
    const customerId = await ensureStripeCustomer(stripe, c.var.db, user);

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
          c.env,
          successPath,
          '/billing/success?session={CHECKOUT_SESSION_ID}',
        ),
        cancel_url: safeReturnUrl(
          c.env,
          cancelPath, '/#pricing'),
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
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: safeReturnUrl(c.env, '/settings', '/settings'),
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

    const customerId = await ensureStripeCustomer(stripe, c.var.db, user);

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: customerId,
        line_items: [{ price: product.storeProductId, quantity: 1 }],
        client_reference_id: user.id,
        // A one-time payment produces a charge and a receipt but NO
        // invoice unless asked. Customers — and their accountants — look
        // for invoices, and the billing page lists invoices; without this
        // every credit pack was invisible there (reported 2026-09-25).
        // Stripe issues the invoice after payment; `invoice.paid` then
        // fires for it, and the webhook ignores invoices with no
        // subscription, so the grant still comes from the checkout event.
        invoice_creation: {
          enabled: true,
          invoice_data: {
            description: `Clickefy — ${pack.displayName}`,
            metadata: {
              clickefy_user_id: user.id,
              clickefy_pack_id: pack.id,
              clickefy_kind: 'topup',
            },
          },
        },
        // The webhook grants from the PACK ROW, looked up by this id — it
        // never trusts a credit amount carried in metadata. Amounts in
        // metadata are a copy of the truth, and a copy can be stale if a
        // pack is re-credited between checkout and payment.
        payment_intent_data: {
          // What the Stripe dashboard shows in its Description column.
          // Unset, it falls back to the PaymentIntent id, which reads as
          // "pi_3UJB2Z…" next to a customer's name.
          description: `Clickefy — ${pack.displayName}`,
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
          c.env,
          successPath,
          '/billing/success?topup=1',
        ),
        cancel_url: safeReturnUrl(
          c.env,
          cancelPath, '/#pricing'),
        allow_promotion_codes: true,
      },
      {
        idempotencyKey: `topup:${user.id}:${pack.id}:${Math.floor(Date.now() / 60_000)}`,
      },
    );

    return c.json({ data: { url: session.url, sessionId: session.id } });
  },
);

// ─── Managing a live subscription ───────────────────────────────────
//
// Everything below assumes the customer already pays us. `/checkout` is
// for starting a subscription; these are for the rest of its life, and
// they exist so that changing or cancelling a plan does not require
// leaving our site for Stripe's portal. The portal still works — some
// people will land there — which is why every one of these reads its
// state back from Stripe rather than from a copy we keep.

/** Plan rows keyed by the Stripe price id that sells them. */
async function planByPriceId(db: AppEnv['Variables']['db']) {
  const rows = await db
    .select({
      priceId: planProducts.storeProductId,
      planId: plans.id,
      tier: plans.tier,
      interval: plans.interval,
      credits: plans.creditsPerPeriod,
      displayName: plans.displayName,
    })
    .from(planProducts)
    .innerJoin(plans, eq(plans.id, planProducts.planId))
    .where(eq(planProducts.platform, 'stripe'));
  return new Map(rows.map((r) => [r.priceId, r]));
}

/**
 * `GET /v1/billing/subscription` — everything the billing page renders.
 *
 * Read LIVE from Stripe on every call rather than from our own columns.
 * We store entitlement and a renewal date because the app needs them on
 * every request, but "is it set to cancel", "what card is on file" and
 * "what is the next amount" are things a customer can change in Stripe's
 * portal without us hearing about it until a webhook lands. On the one
 * page where someone is looking straight at their billing state, stale is
 * worse than slow.
 */
billingRoute.get(
  '/subscription',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const user = c.var.user!;
    const base = {
      entitlement: user.entitlement,
      /** Where the subscription lives; null for a comp or a free account. */
      platform: user.subscriptionPlatform ?? null,
      expiresAt: user.subscriptionExpiresAt?.toISOString() ?? null,
    };

    // No Stripe customer, or a plan that does not come from Stripe (a
    // comp, or an App Store subscription). Everything below would be a
    // pointless round trip, and the client must not offer Stripe controls
    // for a subscription Stripe has never heard of.
    if (!c.env.STRIPE_SECRET_KEY || !user.stripeCustomerId || user.subscriptionPlatform !== 'stripe') {
      return c.json({ data: { ...base, subscription: null, paymentMethod: null } });
    }

    const stripe = makeStripe(c.env.STRIPE_SECRET_KEY);
    const sub = await findLiveSubscription(stripe, user.stripeCustomerId);
    if (!sub) return c.json({ data: { ...base, subscription: null, paymentMethod: null } });

    const byPrice = await planByPriceId(c.var.db);
    const priceId = currentPriceId(sub);
    const plan = priceId ? byPrice.get(priceId) : undefined;
    const pending = await pendingPriceChange(stripe, sub);
    const pendingPlan = pending ? byPrice.get(pending.priceId) : undefined;
    const endsAt = subscriptionEndsAt(sub);

    // The card, for "Visa ending 4242". Expanded off the subscription's
    // default method, falling back to the customer's.
    let paymentMethod: { brand: string; last4: string; expMonth: number; expYear: number } | null = null;
    const pmId =
      typeof sub.default_payment_method === 'string'
        ? sub.default_payment_method
        : (sub.default_payment_method?.id ?? null);
    if (pmId) {
      try {
        const pm = await stripe.paymentMethods.retrieve(pmId);
        if (pm.card) {
          paymentMethod = {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          };
        }
      } catch {
        // A card we cannot read is not worth failing the page over.
      }
    }

    return c.json({
      data: {
        ...base,
        subscription: {
          id: sub.id,
          status: sub.status,
          tier: plan?.tier ?? null,
          interval: plan?.interval ?? null,
          planId: plan?.planId ?? null,
          creditsPerPeriod: plan?.credits ?? null,
          currentPeriodEnd: currentPeriodEnd(sub)?.toISOString() ?? null,
          /** True once cancelled — here OR in Stripe's portal: access runs to `endsAt`, then stops. */
          cancelAtPeriodEnd: endsAt != null,
          endsAt: endsAt?.toISOString() ?? null,
          /** A downgrade already booked for the period end. */
          pendingChange: pending
            ? {
                tier: pendingPlan?.tier ?? null,
                interval: pendingPlan?.interval ?? null,
                planId: pendingPlan?.planId ?? null,
                effectiveAt: pending.effectiveAt?.toISOString() ?? null,
              }
            : null,
        },
        paymentMethod,
      },
    });
  },
);

/**
 * The moment the top-up checkout started asking Stripe for an invoice.
 * Pack charges before it have only a receipt; pack charges after it have
 * an invoice as well, and must not be listed twice.
 */
const PACK_INVOICES_SINCE = Date.UTC(2026, 8, 25, 10, 10, 0); // first deploy went live ~10:05Z; no pack sold between

/**
 * `GET /v1/billing/invoices` — the receipts.
 *
 * Stripe hosts both the PDF and a viewable page, so we hand back links
 * rather than rendering anything ourselves. They are short-lived signed
 * URLs tied to this customer.
 */
billingRoute.get(
  '/invoices',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const user = c.var.user!;
    if (!c.env.STRIPE_SECRET_KEY || !user.stripeCustomerId) {
      return c.json({ data: { invoices: [] } });
    }
    const stripe = makeStripe(c.env.STRIPE_SECRET_KEY);
    const [list, charges] = await Promise.all([
      stripe.invoices.list({ customer: user.stripeCustomerId, limit: 24 }),
      // Credit packs sold before `PACK_INVOICES_SINCE` were one-time
      // payments with no invoice: Stripe holds a charge and a numbered
      // receipt, and nothing can be made for them after the fact. Listing
      // those receipts is the only way a customer sees that purchase in
      // their own account. Packs sold since then have an invoice and are
      // covered by the list above, so nothing shows twice.
      stripe.charges.list({ customer: user.stripeCustomerId, limit: 50 }),
    ]);

    const invoices = list.data
      // A draft invoice is not a receipt of anything yet.
      .filter((i) => i.status !== 'draft')
      .map((i) => ({
        id: i.id,
        kind: 'invoice' as const,
        number: i.number,
        status: i.status,
        description: i.lines?.data?.[0]?.description ?? i.description ?? null,
        amountPaid: i.amount_paid,
        amountDue: i.amount_due,
        currency: i.currency,
        createdAt: new Date(i.created * 1000).toISOString(),
        pdfUrl: i.invoice_pdf,
        hostedUrl: i.hosted_invoice_url,
      }));

    const receipts = charges.data
      .filter(
        (ch) =>
          ch.paid &&
          ch.status === 'succeeded' &&
          // A pack, by the metadata the top-up route writes on its
          // PaymentIntent (charges inherit it). Subscription charges are
          // always covered by an invoice and carry no such marker. The
          // Charge object no longer links to its invoice on this API
          // version, so the era decides instead of the link.
          ch.metadata?.clickefy_kind === 'topup' &&
          ch.created * 1000 < PACK_INVOICES_SINCE,
      )
      .map((ch) => ({
        id: ch.id,
        kind: 'receipt' as const,
        number: ch.receipt_number,
        status: ch.refunded ? 'refunded' : ch.amount_refunded > 0 ? 'partially_refunded' : 'paid',
        description: ch.description ?? null,
        amountPaid: ch.amount - ch.amount_refunded,
        amountDue: 0,
        currency: ch.currency,
        createdAt: new Date(ch.created * 1000).toISOString(),
        pdfUrl: null,
        hostedUrl: ch.receipt_url,
      }));

    return c.json({
      data: {
        invoices: [...invoices, ...receipts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      },
    });
  },
);

const changePlanSchema = z.object({ planId: z.string().uuid() }).strict();

/**
 * `POST /v1/billing/change-plan` — move between tiers.
 *
 * Upgrades charge the FULL new price now, keep every unspent credit and
 * restart the billing cycle today; downgrades are booked for the period
 * end. `lib/stripe-subscription.ts` explains why those are not
 * symmetrical. Yearly plans are not changed here at all.
 */
billingRoute.post(
  '/change-plan',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  zValidator('json', changePlanSchema),
  async (c) => {
    const user = c.var.user!;
    const { planId } = c.req.valid('json');
    if (!c.env.STRIPE_SECRET_KEY) {
      return c.json({ error: { code: 'stripe_unconfigured', message: 'Payments are not configured.' } }, 503);
    }
    if (user.subscriptionPlatform !== 'stripe' || !user.stripeCustomerId) {
      return c.json(
        {
          error: {
            code: 'no_stripe_subscription',
            message: 'This account has no web subscription to change.',
          },
        },
        409,
      );
    }

    const plan = await c.var.db.query.plans.findFirst({
      where: and(eq(plans.id, planId), eq(plans.isActive, true)),
    });
    if (!plan) return c.json({ error: { code: 'plan_not_found', message: 'Plan not found.' } }, 404);

    const product = await c.var.db.query.planProducts.findFirst({
      where: and(
        eq(planProducts.planId, planId),
        eq(planProducts.platform, 'stripe'),
        eq(planProducts.isActive, true),
      ),
    });
    if (!product) {
      return c.json(
        { error: { code: 'plan_not_purchasable', message: 'This plan is not available yet.' } },
        409,
      );
    }

    const stripe = makeStripe(c.env.STRIPE_SECRET_KEY);
    const sub = await findLiveSubscription(stripe, user.stripeCustomerId);
    if (!sub) {
      return c.json(
        {
          error: {
            code: 'no_stripe_subscription',
            message: 'No live subscription found. Start a new one instead.',
          },
        },
        409,
      );
    }

    if (currentPriceId(sub) === product.storeProductId) {
      return c.json(
        { error: { code: 'already_on_plan', message: 'You are already on this plan.' } },
        409,
      );
    }

    // Only monthly → monthly is self-serve. A yearly plan is twelve
    // prepaid allowances, and changing it mid-year means either handing
    // over the undelivered ones at once or inventing a proration — a
    // decision for a person, not this handler, until a rule exists.
    const currentPrice = currentPriceId(sub);
    const currentPlan = currentPrice ? (await planByPriceId(c.var.db)).get(currentPrice) : undefined;
    const fromInterval = (currentPlan?.interval as PlanInterval | undefined) ?? null;
    if (!isSelfServePlanChange(fromInterval, plan.interval as PlanInterval)) {
      return c.json(
        {
          error: {
            code: 'plan_change_needs_support',
            message:
              'Changes to or from a yearly plan are handled by our team. Contact us and we will sort it out.',
            details: { fromInterval, toInterval: plan.interval },
          },
        },
        409,
      );
    }

    let result;
    try {
      result = await changePlan(stripe, sub, {
        newPriceId: product.storeProductId,
        fromTier: user.entitlement,
        toTier: plan.tier as UserEntitlement,
        userId: user.id,
      });
    } catch (err) {
      // An upgrade charges the full new price on the spot. A declined
      // card comes back from Stripe as a card error, the subscription is
      // left exactly as it was (`error_if_incomplete`), and the customer
      // should hear what the bank said rather than "something went wrong".
      const e = err as { type?: string; code?: string; statusCode?: number; message?: string };
      if (e?.type === 'StripeCardError' || e?.statusCode === 402) {
        return c.json(
          {
            error: {
              code: 'payment_failed',
              message: e.message ?? 'Your card was declined.',
              details: { declineCode: e.code ?? null },
            },
          },
          402,
        );
      }
      throw err;
    }

    // The entitlement and the credits both follow from the webhook, not
    // from here: an upgrade's invoice grants them, and a downgrade grants
    // nothing until the period turns over. Writing either here would race
    // the webhook and double-count.
    return c.json({
      data: {
        direction: result.direction,
        chargedNow: result.chargedNow,
        effectiveAt: result.effectiveAt?.toISOString() ?? null,
        tier: plan.tier,
        interval: plan.interval,
      },
    });
  },
);

const cancelSchema = z
  .object({
    /** Stripe's own survey values, so the reason lands in their dashboard. */
    reason: z
      .enum(['too_expensive', 'missing_features', 'switched_service', 'unused', 'customer_service', 'too_complex', 'low_quality', 'other'])
      .optional(),
    comment: z.string().max(500).optional(),
  })
  .strict();

/**
 * `POST /v1/billing/cancel` — stop at the end of the paid period.
 *
 * NOT an immediate cancellation. They have paid for this period; ending
 * it early would mean taking the money and withdrawing the service. The
 * subscription stays `active`, `cancel_at_period_end` goes true, and
 * Stripe's `customer.subscription.deleted` at the boundary is what
 * actually revokes access — one teardown path, whoever pressed cancel.
 */
billingRoute.post(
  '/cancel',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  zValidator('json', cancelSchema),
  async (c) => {
    const user = c.var.user!;
    const { reason, comment } = c.req.valid('json');
    if (!c.env.STRIPE_SECRET_KEY || !user.stripeCustomerId) {
      return c.json({ error: { code: 'no_stripe_customer', message: 'No web billing account.' } }, 404);
    }
    const stripe = makeStripe(c.env.STRIPE_SECRET_KEY);
    const sub = await findLiveSubscription(stripe, user.stripeCustomerId);
    if (!sub) {
      return c.json({ error: { code: 'no_stripe_subscription', message: 'Nothing to cancel.' } }, 409);
    }

    // Stripe refuses `cancel_at_period_end` while a schedule is attached
    // — and one stays attached for a whole period after a downgrade
    // lands, not only while it is pending. Cancelling supersedes any
    // booked change, so releasing first is the right outcome as well as
    // the only one Stripe allows.
    await cancelPendingChange(stripe, sub);

    const updated = await stripe.subscriptions.update(sub.id, {
      cancel_at_period_end: true,
      cancellation_details: {
        ...(reason ? { feedback: reason } : {}),
        ...(comment ? { comment } : {}),
      },
    });

    return c.json({
      data: {
        cancelAtPeriodEnd: true,
        // What they keep until, so the UI can say it plainly.
        accessUntil: currentPeriodEnd(updated)?.toISOString() ?? null,
      },
    });
  },
);

/**
 * `POST /v1/billing/resume` — undo a cancellation, or a booked downgrade.
 *
 * Only possible before the period ends; afterwards the subscription is
 * gone and there is nothing to resume, which is why the client offers
 * this alongside "your plan ends on …" and not after.
 */
billingRoute.post(
  '/resume',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const user = c.var.user!;
    if (!c.env.STRIPE_SECRET_KEY || !user.stripeCustomerId) {
      return c.json({ error: { code: 'no_stripe_customer', message: 'No web billing account.' } }, 404);
    }
    const stripe = makeStripe(c.env.STRIPE_SECRET_KEY);
    const sub = await findLiveSubscription(stripe, user.stripeCustomerId);
    if (!sub) {
      return c.json({ error: { code: 'no_stripe_subscription', message: 'Nothing to resume.' } }, 409);
    }

    const releasedChange = await cancelPendingChange(stripe, sub);
    // Clear BOTH spellings. The portal books a cancellation as
    // `cancel_at`; our own route as `cancel_at_period_end`. Clearing only
    // the flag left a portal cancellation in place — the plan looked
    // resumed and still ended.
    const updated = subscriptionEndsAt(sub)
      ? await stripe.subscriptions.update(sub.id, { cancel_at: '' })
      : sub;

    return c.json({
      data: {
        cancelAtPeriodEnd: false,
        pendingChangeCancelled: releasedChange,
        renewsAt: currentPeriodEnd(updated)?.toISOString() ?? null,
      },
    });
  },
);
