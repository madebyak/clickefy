/**
 * Stripe webhook handler.
 *
 *   URL: https://api.clickefy.ai/v1/webhooks/stripe
 *
 * Deliberately shaped like the RevenueCat handler next door, because that
 * design has already earned its keep in production. Both write through the
 * SAME grant helpers, so a credit bought on the web and a credit bought in
 * the app are created by identical code — there is no second, subtly
 * different notion of what a subscription grant means.
 *
 * ─── Events we act on ───────────────────────────────────────────────
 *
 *   invoice.paid                   → THE grant event. Fires on the first
 *                                    payment and on every renewal.
 *   customer.subscription.updated  → plan change; also carries the status
 *                                    transitions (past_due, unpaid…)
 *   customer.subscription.deleted  → revoke
 *   invoice.payment_failed         → recorded only. Stripe's Smart Retries
 *                                    run first; revoking on the first
 *                                    failed charge would cut off customers
 *                                    whose card simply needed a retry.
 *   charge.refunded                → clawback
 *
 * Provisioning rides on `invoice.paid`, NOT `checkout.session.completed`.
 * Checkout fires once, ever; a subscriber who renews for a year would be
 * granted credits in month one and nothing after. This is Stripe's own
 * guidance and it is an easy, expensive thing to get backwards.
 *
 * ─── Idempotency ────────────────────────────────────────────────────
 *
 *   - `stripe_events.event_id` is UNIQUE.
 *   - Dedupe is PROCESSING-STATE-AWARE: a replay of a SUCCESSFUL event
 *     short-circuits, a replay of a FAILED one re-processes. Stripe
 *     retries for up to three days, so a missing catalogue row is
 *     recoverable rather than a permanently lost paid grant.
 *   - Grants additionally carry the Stripe object id as `source_ref`, so
 *     even a bug here cannot double-credit: the lot's unique index refuses
 *     the second write.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

import { planProducts, plans, stripeEvents, users } from '@clickfy/db';

import {
  closeSubscriptionLots,
  grantCredits,
  pauseTopupClocks,
  resumeTopupClocks,
  revokeCredits,
} from '../../lib/credit-grants';
import { makeStripe, verifyStripeEvent } from '../../lib/stripe-client';
import type { AppEnv } from '../../types';

export const stripeWebhookRoute = new Hono<AppEnv>();

/** Events worth acting on. Everything else is recorded and ignored. */
const HANDLED = new Set([
  'invoice.paid',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'charge.refunded',
]);

stripeWebhookRoute.post('/', async (c) => {
  const secretKey = c.env.STRIPE_SECRET_KEY;
  const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return c.json(
      {
        error: {
          code: 'webhook_unconfigured',
          message: 'STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are not set.',
        },
      },
      500,
    );
  }

  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: { code: 'missing_signature', message: 'No signature.' } }, 400);
  }

  // Read the body ONCE, as raw text, before anything parses it. The
  // signature covers these exact bytes; re-serialising parsed JSON changes
  // them and verification fails.
  const rawBody = await c.req.text();

  const stripe = makeStripe(secretKey);
  let event: Stripe.Event;
  try {
    event = await verifyStripeEvent(stripe, rawBody, signature, webhookSecret);
  } catch (err) {
    console.warn('[stripe webhook] signature verification failed', err);
    return c.json(
      { error: { code: 'invalid_signature', message: 'Signature verification failed.' } },
      400,
    );
  }

  // Pull the identifying ids off whichever object this event carries.
  // Stripe's Event.data.object is a union of ~80 resource types, so a
  // direct cast is rejected. We only read three optional ids off it.
  const obj = event.data.object as unknown as Record<string, unknown>;
  const customerId =
    typeof obj.customer === 'string' ? obj.customer : (obj.customer as { id?: string })?.id ?? null;
  const subscriptionId =
    typeof obj.subscription === 'string'
      ? obj.subscription
      : event.type.startsWith('customer.subscription')
        ? (obj.id as string)
        : null;
  const invoiceId = event.type.startsWith('invoice') ? (obj.id as string) : null;

  const userRow = customerId
    ? await c.var.db.query.users.findFirst({ where: eq(users.stripeCustomerId, customerId) })
    : null;

  // Audit insert first. `onConflictDoNothing` means exactly one delivery
  // wins even under concurrent duplicates.
  const inserted = await c.var.db
    .insert(stripeEvents)
    .values({
      eventId: event.id,
      eventType: event.type,
      stripeCustomerId: customerId,
      userId: userRow?.id ?? null,
      subscriptionId,
      invoiceId,
      payload: event as unknown as Record<string, unknown>,
      eventCreatedAt: new Date(event.created * 1000),
    })
    .onConflictDoNothing({ target: stripeEvents.eventId })
    .returning();

  let eventRowId: string;
  if (inserted.length > 0) {
    eventRowId = inserted[0]!.id;
  } else {
    const existing = await c.var.db.query.stripeEvents.findFirst({
      where: eq(stripeEvents.eventId, event.id),
      columns: { id: true, processedAt: true },
    });
    if (!existing) {
      return c.json({ error: { code: 'transient', message: 'Retry.' } }, 503);
    }
    // Already succeeded → nothing to do. Failed before → fall through and
    // try again; that is what makes a missing plan row recoverable.
    if (existing.processedAt) return c.json({ ok: true, deduped: true });
    eventRowId = existing.id;
  }

  const markProcessed = (note?: string) =>
    c.var.db
      .update(stripeEvents)
      .set({ processedAt: new Date(), processingError: note ?? null })
      .where(eq(stripeEvents.id, eventRowId));

  if (!HANDLED.has(event.type)) {
    await markProcessed('recorded, no action for this type');
    return c.json({ ok: true, applied: false });
  }

  if (!userRow) {
    // A valid customer we cannot match yet — usually provisioning lag.
    // Leave it unprocessed and ask Stripe to retry.
    await c.var.db
      .update(stripeEvents)
      .set({ processingError: 'no user for this Stripe customer — retrying' })
      .where(eq(stripeEvents.id, eventRowId));
    return c.json({ error: { code: 'user_not_found', message: 'Retry.' } }, 503);
  }

  try {
    let note: string | undefined;

    switch (event.type) {
      case 'invoice.paid':
        note = await applyInvoicePaid(c, stripe, userRow.id, event);
        break;
      case 'customer.subscription.updated':
        note = await applySubscriptionUpdated(c, userRow.id, event);
        break;
      case 'customer.subscription.deleted':
        note = await applySubscriptionDeleted(c, userRow.id);
        break;
      case 'invoice.payment_failed':
        // Recorded only. Stripe's Smart Retries get several attempts
        // before a subscription is actually cancelled; revoking here would
        // cut off customers whose card just needed a retry.
        note = 'payment failed — awaiting Stripe retries, access unchanged';
        break;
      case 'charge.refunded':
        note = await applyChargeRefunded(c, userRow.id, event);
        break;
    }

    await markProcessed(note);
    return c.json({ ok: true, applied: true, ...(note ? { note } : {}) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[stripe webhook] processing failed', err);
    // Leave `processed_at` NULL and 500, so Stripe retries and the
    // state-aware dedupe above lets the retry actually re-process.
    await c.var.db
      .update(stripeEvents)
      .set({ processingError: message })
      .where(eq(stripeEvents.id, eventRowId));
    return c.json(
      { error: { code: 'processing_error', message: 'Processing failed; retry.' } },
      500,
    );
  }
});

/**
 * `invoice.paid` — the grant. Fires on first payment and every renewal.
 *
 * Resolves the plan from the PRICE on the invoice line, because that is
 * the only thing that survives a plan change: the subscription's metadata
 * still names whatever was bought originally.
 */
async function applyInvoicePaid(
  c: { var: AppEnv['Variables']; env: AppEnv['Bindings'] },
  stripe: Stripe,
  userId: string,
  event: Stripe.Event,
): Promise<string | undefined> {
  const invoice = event.data.object as Stripe.Invoice;

  // Zero-amount invoices (a 100% coupon, a proration credit) still arrive
  // here. They are legitimate, so they still grant.
  const line = invoice.lines?.data?.[0];
  const priceId =
    (line?.pricing?.price_details?.price as string | undefined) ??
    ((line as unknown as { price?: { id?: string } })?.price?.id ?? undefined);

  if (!priceId) return 'no price on invoice — nothing to grant';

  const product = await c.var.db.query.planProducts.findFirst({
    where: eq(planProducts.storeProductId, priceId),
  });
  if (!product) {
    // Throw so Stripe retries: registering the price makes this heal.
    throw new Error(
      `unknown Stripe price '${priceId}' — link it in plan_products before this can grant`,
    );
  }
  const plan = await c.var.db.query.plans.findFirst({ where: eq(plans.id, product.planId) });
  if (!plan) throw new Error(`plan_products row points at a missing plan (${product.planId})`);

  const periodEnd = invoice.period_end ? new Date(invoice.period_end * 1000) : null;
  // Credits are per 30 DAYS even on a yearly plan — a yearly subscriber is
  // topped up by `refresh-subscription-credits`, not handed a year at once.
  const creditsExpireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Use-it-or-lose-it, exactly as the store path does.
  const forfeited = await closeSubscriptionLots(
    c.var.db,
    userId,
    `Stripe ${plan.tier}/${plan.interval} renewal`,
  );

  await c.var.db
    .update(users)
    .set({
      entitlement: plan.tier as typeof users.$inferSelect.entitlement,
      subscriptionPlatform: 'stripe',
      subscriptionProductId: priceId,
      subscriptionRenewsAt: periodEnd,
      subscriptionExpiresAt: periodEnd,
    })
    .where(eq(users.id, userId));

  await grantCredits(c.var.db, {
    userId,
    class: 'subscription',
    kind: 'subscription',
    amount: plan.creditsPerPeriod,
    expiresAt: creditsExpireAt,
    reason: 'subscription_grant',
    sourcePlatform: 'stripe',
    // The invoice id makes a redelivery a no-op at the database level.
    sourceRef: invoice.id,
    note: `Stripe ${plan.tier}/${plan.interval}`,
    metadata: { priceId, tier: plan.tier, interval: plan.interval, invoiceId: invoice.id },
  });

  const resumed = await resumeTopupClocks(c.var.db, userId);

  const notes: string[] = [`granted ${plan.creditsPerPeriod} (${plan.tier})`];
  if (forfeited > 0) notes.push(`forfeited ${forfeited} unspent`);
  if (resumed > 0) notes.push(`resumed ${resumed} topup clock(s)`);
  return notes.join('; ');
}

/**
 * `customer.subscription.updated` — plan changes and status transitions.
 *
 * The CREDIT grant for an upgrade arrives as its own `invoice.paid`, so
 * this only tracks state. Acting on both would grant twice.
 */
async function applySubscriptionUpdated(
  c: { var: AppEnv['Variables'] },
  userId: string,
  event: Stripe.Event,
): Promise<string | undefined> {
  const sub = event.data.object as Stripe.Subscription;

  // `unpaid` and `canceled` mean access ends. `past_due` does NOT — Stripe
  // is still retrying and the customer usually recovers.
  if (sub.status === 'unpaid' || sub.status === 'canceled') {
    return applySubscriptionDeleted(c, userId);
  }

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id;
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000)
    : null;

  if (priceId) {
    const product = await c.var.db.query.planProducts.findFirst({
      where: eq(planProducts.storeProductId, priceId),
    });
    if (product) {
      const plan = await c.var.db.query.plans.findFirst({ where: eq(plans.id, product.planId) });
      if (plan) {
        await c.var.db
          .update(users)
          .set({
            entitlement: plan.tier as typeof users.$inferSelect.entitlement,
            subscriptionPlatform: 'stripe',
            subscriptionProductId: priceId,
            subscriptionRenewsAt: periodEnd,
            subscriptionExpiresAt: periodEnd,
          })
          .where(eq(users.id, userId));
        return `status ${sub.status}, now on ${plan.tier}/${plan.interval}`;
      }
    }
  }
  return `status ${sub.status}`;
}

/** Access ends: entitlement to free, allowance forfeited, top-up clocks frozen. */
async function applySubscriptionDeleted(
  c: { var: AppEnv['Variables'] },
  userId: string,
): Promise<string | undefined> {
  await c.var.db
    .update(users)
    .set({
      entitlement: 'free',
      subscriptionPlatform: null,
      subscriptionProductId: null,
      subscriptionRenewsAt: null,
      subscriptionExpiresAt: null,
    })
    .where(eq(users.id, userId));

  const forfeited = await closeSubscriptionLots(c.var.db, userId, 'Stripe subscription ended');
  // Top-ups survive but become unspendable, so their clock stops rather
  // than burning time the user cannot use.
  const paused = await pauseTopupClocks(c.var.db, userId);

  const notes: string[] = ['subscription ended'];
  if (forfeited > 0) notes.push(`forfeited ${forfeited}`);
  if (paused > 0) notes.push(`paused ${paused} topup clock(s)`);
  return notes.join('; ');
}

/**
 * `charge.refunded` — claw back, clamped at what is left.
 *
 * Tracing a charge to what it paid for is a multi-hop walk in Stripe:
 * charge → payment_intent → invoice → subscription. Worth doing properly
 * once; guessing from the amount would reclaim the wrong credits.
 */
async function applyChargeRefunded(
  c: { var: AppEnv['Variables'] },
  userId: string,
  event: Stripe.Event,
): Promise<string | undefined> {
  const charge = event.data.object as Stripe.Charge;
  const refunded = charge.amount_refunded ?? 0;
  const total = charge.amount ?? 0;
  if (total <= 0 || refunded <= 0) return 'nothing refunded';

  // Reclaim PROPORTIONALLY to how much of the charge was refunded, so a
  // partial refund takes back a proportional share rather than all or
  // nothing. Clamped at what actually remains: if the credits are already
  // spent we absorb the difference rather than pushing the balance
  // negative, which the balance CHECK would reject anyway.
  const lots = await c.var.db.query.creditLots.findMany({
    where: (cl, { and: a, eq: e, gt }) =>
      a(e(cl.userId, userId), e(cl.class, 'subscription'), gt(cl.amountRemaining, 0)),
  });
  const outstanding = lots.reduce((n, l) => n + l.amountRemaining, 0);
  if (outstanding <= 0) return 'nothing left to reclaim (credits already spent)';

  const share = Math.min(1, refunded / total);
  const toReclaim = Math.floor(outstanding * share);
  if (toReclaim <= 0) return 'refund too small to reclaim a whole credit';

  const clawed = await revokeCredits(c.var.db, {
    userId,
    class: 'subscription',
    amount: toReclaim,
    reason: 'admin_adjust',
    note: `Stripe refund ${charge.id}`,
    metadata: {
      stripeRefund: true,
      chargeId: charge.id,
      amountRefunded: refunded,
      amountTotal: total,
      sharePct: Math.round(share * 100),
    },
  });
  return `refund clawback (${clawed} of ${toReclaim} reclaimed, ${Math.round(share * 100)}% of charge)`;
}
