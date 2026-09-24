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
import { eq, sql } from 'drizzle-orm';
import type Stripe from 'stripe';

import { creditPacks, planProducts, plans, stripeEvents, users } from '@clickfy/db';
import {
  decideRollover,
  evaluateSubscriptionRefund,
  resolveInvoicePriceId,
  resolvePeriodEnd,
  subscriptionLotExpiry,
  type PlanInterval,
  type UserEntitlement,
} from '@clickfy/types';

import {
  DUNNING_GRACE_HOURS,
  MAX_PAYMENT_ATTEMPTS,
  cancelSubscription,
  cancelSubscriptionsForCustomer,
} from '../../lib/dunning';

import {
  TOPUP_LIFETIME_MS,
  grantCredits,
  resumeTopupClocks,
  revokeCredits,
  rolloverSubscriptionLots,
} from '../../lib/credit-grants';
import { makeStripe, verifyStripeEvent } from '../../lib/stripe-client';
import { currentPriceId } from '../../lib/stripe-subscription';
import { endSubscriptionAccess } from '../../lib/subscription-lifecycle';
import type { AppEnv } from '../../types';

export const stripeWebhookRoute = new Hono<AppEnv>();

/**
 * The subscription an invoice belongs to.
 *
 * `invoice.subscription` was REMOVED from the Stripe API — it now lives at
 * `invoice.parent.subscription_details.subscription`. Reading the old
 * field returned undefined on every invoice, which meant the payment
 * failure path could never find a subscription to cancel and quietly fell
 * through to "the sweep will catch it". It did catch it, so nothing
 * leaked; the fast path was simply dead code that looked alive.
 *
 * Both shapes are accepted because an older API version, a replayed
 * event, or a fixture can still carry the flat field.
 */
function invoiceSubscriptionId(invoice: Record<string, unknown>): string | null {
  const parent = invoice.parent as
    | { subscription_details?: { subscription?: string | { id?: string } } }
    | undefined;
  const fromParent = parent?.subscription_details?.subscription;
  if (typeof fromParent === 'string') return fromParent;
  if (fromParent?.id) return fromParent.id;

  const legacy = invoice.subscription as string | { id?: string } | undefined | null;
  if (typeof legacy === 'string') return legacy;
  return legacy?.id ?? null;
}

/** Events worth acting on. Everything else is recorded and ignored. */
const HANDLED = new Set([
  'invoice.paid',
  // One-time credit-pack purchases. `checkout.session.completed` is the
  // RIGHT event here, and the wrong one for subscriptions — it fires once
  // per checkout, which is exactly a top-up's lifecycle and exactly not a
  // renewal's.
  'checkout.session.completed',
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

  // A TEST event has no business reaching live data, and a live event has
  // no business reaching a sandbox. Stripe stamps every event with which
  // world it came from, so the check is free — and it is the difference
  // between a stray sandbox delivery being ignored and it granting real
  // credits. (The signature alone does not settle this: a test-mode
  // endpoint configured against this URL signs its deliveries perfectly
  // well.)
  //
  // The expectation comes from the KEY, not from `ENVIRONMENT`. Both are
  // the same in production, but `wrangler dev` inherits the production
  // vars, so keying off the environment would reject every event from
  // `stripe listen` on a developer's machine. The key and the event must
  // simply come from the same world as each other.
  const expectLive = secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_');
  if (event.livemode !== expectLive) {
    console.warn('[stripe webhook] livemode mismatch, ignoring', {
      eventId: event.id,
      type: event.type,
      eventLivemode: event.livemode,
      expectLive,
    });
    // 200, not an error: Stripe should stop retrying something we will
    // never accept, and a retry storm on a misconfigured endpoint helps
    // nobody.
    return c.json({ ok: true, ignored: 'livemode mismatch' });
  }

  // Pull the identifying ids off whichever object this event carries.
  // Stripe's Event.data.object is a union of ~80 resource types, so a
  // direct cast is rejected. We only read three optional ids off it.
  const obj = event.data.object as unknown as Record<string, unknown>;
  const customerId =
    typeof obj.customer === 'string' ? obj.customer : (obj.customer as { id?: string })?.id ?? null;
  const subscriptionId =
    event.type.startsWith('customer.subscription')
      ? (obj.id as string)
      : invoiceSubscriptionId(obj);
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
        note = await applyPaymentFailed(c, stripe, event);
        break;
      case 'checkout.session.completed':
        note = await applyCheckoutCompleted(c, userRow.id, event);
        break;
      case 'charge.refunded':
        note = await applyChargeRefunded(c, stripe, userRow.id, event);
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
 * WHICH PLAN: the subscription's CURRENT price, read from Stripe, with
 * the invoice's largest positive line as the fallback. Never `lines[0]`:
 * on a proration invoice Stripe puts the negative "unused time on the
 * old plan" line first, and reading it granted a customer who had just
 * paid for Ultimate the Creator allowance (2026-09-23).
 *
 * CARRY OR WIPE: decided by the tier ladder, from our own ledger — see
 * `decideRollover` for why neither `billing_reason` nor
 * `users.entitlement` can be trusted for this.
 *
 *   upgrade   → keep every unspent credit, add the new allowance
 *   renewal   → wipe, fresh allowance
 *   downgrade → wipe, the smaller allowance
 *
 * EXPIRY: a monthly lot lives until the real period end on the invoice;
 * a yearly lot lives 30 days and the refresh task takes it from there.
 *
 * Close + grant is ONE statement (`rolloverSubscriptionLots`), so a retry
 * after a partial failure cannot lose the carried balance.
 */
async function applyInvoicePaid(
  c: { var: AppEnv['Variables']; env: AppEnv['Bindings'] },
  stripe: Stripe,
  userId: string,
  event: Stripe.Event,
): Promise<string | undefined> {
  const invoice = event.data.object as Stripe.Invoice;

  // Every line, in a shape the policy can read. Both price fields are
  // accepted: `pricing.price_details.price` is current, `price.id` is
  // what an older API version or a fixture carries.
  const lines = (invoice.lines?.data ?? []).map((line) => ({
    amount: typeof line.amount === 'number' ? line.amount : 0,
    priceId:
      (line.pricing?.price_details?.price as string | undefined) ??
      ((line as unknown as { price?: { id?: string } }).price?.id ?? null),
    periodEnd: typeof line.period?.end === 'number' ? line.period.end : null,
  }));

  // The subscription is the truth about which plan is being paid for. A
  // failed read falls back to the invoice's own lines rather than
  // failing the grant — Stripe would retry, but the customer has paid.
  const subscriptionId = invoiceSubscriptionId(invoice as unknown as Record<string, unknown>);
  let subscriptionPriceId: string | null = null;
  if (subscriptionId) {
    try {
      subscriptionPriceId = currentPriceId(await stripe.subscriptions.retrieve(subscriptionId));
    } catch (err) {
      console.warn('[stripe webhook] could not read subscription for invoice', {
        subscriptionId,
        invoiceId: invoice.id,
        err: String(err),
      });
    }
  }

  const priceId = resolveInvoicePriceId(lines, subscriptionPriceId);
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
  const interval = plan.interval as PlanInterval;
  const tier = plan.tier as UserEntitlement;

  // The period from the line that carries THIS price. A proration
  // invoice's negative line belongs to the old plan and must not set the
  // renewal date; `invoice.period_end` is worse still — on a first
  // invoice it is the instant the subscription was created.
  const periodEndSec = resolvePeriodEnd(lines, priceId);
  const periodEnd = periodEndSec ? new Date(periodEndSec * 1000) : null;

  // The tier of the customer's most recent subscription grant, from our
  // ledger. `users.entitlement` may already have been advanced by the
  // `customer.subscription.updated` that races this event.
  const prev = await c.var.db.execute<{ tier: string | null }>(sql`
    SELECT metadata->>'tier' AS tier
    FROM credit_ledger
    WHERE user_id = ${userId}::uuid AND reason = 'subscription_grant'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const prevRows = Array.isArray(prev) ? prev : ((prev as { rows?: unknown[] }).rows ?? []);
  const previousTier = ((prevRows[0] as { tier?: string | null } | undefined)?.tier ??
    null) as UserEntitlement | null;

  const decision = decideRollover(previousTier, tier);
  const expiresAt = subscriptionLotExpiry(interval, periodEnd);

  // Credits FIRST, then the user row. If the second write fails, Stripe's
  // retry finds the lot already issued (a no-op) and completes the row;
  // the other way round a failure would leave a tier with no credits
  // behind it until the retry landed.
  const rolled = await rolloverSubscriptionLots(c.var.db, {
    userId,
    allowance: plan.creditsPerPeriod,
    carry: decision === 'carry',
    expiresAt,
    sourcePlatform: 'stripe',
    // The invoice id makes a redelivery a no-op at the database level.
    sourceRef: invoice.id,
    note: `Stripe ${plan.tier}/${plan.interval}`,
    metadata: {
      priceId,
      tier: plan.tier,
      interval: plan.interval,
      invoiceId: invoice.id,
      billingReason: invoice.billing_reason ?? null,
      allowance: plan.creditsPerPeriod,
      previousTier,
      decision,
    },
  });

  await c.var.db
    .update(users)
    .set({
      entitlement: tier as typeof users.$inferSelect.entitlement,
      subscriptionPlatform: 'stripe',
      subscriptionProductId: priceId,
      subscriptionRenewsAt: periodEnd,
      subscriptionExpiresAt: periodEnd,
    })
    .where(eq(users.id, userId));

  const resumed = await resumeTopupClocks(c.var.db, userId);

  if (!rolled) return `already granted for ${invoice.id} (replay)`;
  const notes: string[] = [`granted ${rolled.granted} (${plan.tier}, ${decision})`];
  if (rolled.carried > 0) notes.push(`carried ${rolled.carried} forward`);
  if (rolled.forfeited > 0) notes.push(`forfeited ${rolled.forfeited} unspent`);
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

/**
 * Access ends: entitlement to free, allowance forfeited, top-up clocks
 * frozen. Shared with the reconcile sweep, which handles the case where
 * this webhook never arrives — both must tear down identically.
 */
async function applySubscriptionDeleted(
  c: { var: AppEnv['Variables'] },
  userId: string,
): Promise<string | undefined> {
  return endSubscriptionAccess(c.var.db, userId, 'Stripe subscription ended');
}

/**
 * `invoice.payment_failed` — a renewal did not go through.
 *
 * Stripe gets `MAX_PAYMENT_ATTEMPTS` tries, then the subscription ends.
 * This used to record the event and change nothing, on the reasoning that
 * Smart Retries usually recover a card. True, but the cost of being wrong
 * is asymmetric: every generation bills a model provider in real money
 * the moment it runs, so weeks of "past due but still working" is weeks
 * of us paying BytePlus and Google for someone whose card has declined.
 *
 * The FIRST failure is still a warning, not a cancellation — cards fail
 * for reasons that resolve themselves within a day, and cutting someone
 * off over a bank's fraud check would be its own kind of wrong.
 *
 * Cancelling is done IN STRIPE, not here. Stripe's
 * `customer.subscription.deleted` then performs the teardown, so exactly
 * one code path ever forfeits credits. Marking the user free here instead
 * would leave an active subscription in Stripe, and the next successful
 * invoice would silently re-grant a month of credits to an account we
 * believed was cancelled.
 *
 * The hourly sweep in `enforceDunningDeadline` is the real guarantee —
 * `attempt_count` depends on a retry schedule that lives in dashboard
 * configuration and can drift. This is the fast path, not the safety net.
 */
async function applyPaymentFailed(
  c: { var: AppEnv['Variables'] },
  stripe: Stripe,
  event: Stripe.Event,
): Promise<string> {
  const invoice = event.data.object as unknown as Record<string, unknown>;
  const attempts = typeof invoice.attempt_count === 'number' ? invoice.attempt_count : 0;

  const subId = invoiceSubscriptionId(invoice);

  if (attempts < MAX_PAYMENT_ATTEMPTS) {
    return (
      `payment failed (attempt ${attempts} of ${MAX_PAYMENT_ATTEMPTS}) — ` +
      `access continues until ${DUNNING_GRACE_HOURS}h from first failure`
    );
  }

  if (!subId) {
    return `payment failed (attempt ${attempts}) but no subscription on the invoice — sweep will catch it`;
  }

  const cancelled = await cancelSubscription(
    stripe,
    subId,
    `Payment failed ${attempts} times — exceeds the ${MAX_PAYMENT_ATTEMPTS}-attempt limit`,
  );
  return cancelled
    ? `payment failed ${attempts}x — subscription cancelled in Stripe; teardown follows on subscription.deleted`
    : `payment failed ${attempts}x — subscription already gone`;
}

/**
 * `checkout.session.completed` — a credit pack was bought.
 *
 * WHY THIS EVENT, when subscriptions deliberately avoid it: a top-up
 * happens exactly once. There is no renewal to miss, so the event that
 * fires once per checkout is the correct one. Using `invoice.paid` here
 * would work for the first purchase and then never fire again, and using
 * `checkout.session.completed` for SUBSCRIPTIONS would grant the first
 * month and silently stop — which is why the two paths are split.
 *
 * THREE GUARDS before a single credit moves:
 *
 *  1. `mode === 'payment'`. Subscription checkouts also emit this event;
 *     granting on them would hand out a top-up on top of the plan credits
 *     `invoice.paid` is already about to grant. Double-granting every new
 *     subscriber is the single most expensive bug available here.
 *  2. `payment_status === 'paid'`. A session can complete with payment
 *     still pending (delayed methods settle hours later). Crediting on
 *     completion rather than payment gives away credits for money that
 *     has not arrived.
 *  3. The pack is re-read FROM THE DATABASE by id. The credit amount in
 *     metadata is a copy made at checkout time; the row is the truth. If
 *     a pack were re-credited between checkout and payment, the customer
 *     gets what the catalogue says today, not what a stale copy claimed.
 *
 * Idempotency is the session id as `source_ref`, so a Stripe redelivery
 * loses the lot insert and grants nothing — on top of the handler's own
 * event dedupe.
 */
async function applyCheckoutCompleted(
  c: { var: AppEnv['Variables']; env: AppEnv['Bindings'] },
  userId: string,
  event: Stripe.Event,
): Promise<string> {
  const session = event.data.object as unknown as Record<string, unknown>;

  const mode = typeof session.mode === 'string' ? session.mode : null;
  if (mode !== 'payment') {
    // A subscription checkout. `invoice.paid` owns that path entirely.
    return `checkout completed in ${mode ?? 'unknown'} mode — subscription path handles it`;
  }

  const paymentStatus = typeof session.payment_status === 'string' ? session.payment_status : null;
  if (paymentStatus !== 'paid') {
    return `checkout completed but payment_status=${paymentStatus ?? 'unknown'} — no credits until paid`;
  }

  const metadata = (session.metadata ?? {}) as Record<string, string>;
  const packId = metadata.clickefy_pack_id;
  if (!packId) {
    return 'one-time payment with no clickefy_pack_id — nothing to grant';
  }

  const pack = await c.var.db.query.creditPacks.findFirst({
    where: eq(creditPacks.id, packId),
  });
  if (!pack) {
    // THROW, do not shrug. The customer has paid; a missing catalogue row
    // is a configuration fault we must retry into, not swallow. Stripe
    // redelivers for three days, which is ample time to restore the row.
    throw new Error(
      `paid top-up references unknown pack id='${packId}' — restore the credit_packs row`,
    );
  }

  const amount = pack.credits + pack.bonusCredits;
  if (amount <= 0) {
    throw new Error(`pack '${pack.storeProductId}' grants ${amount} credits — refusing to charge for nothing`);
  }

  const sessionId = typeof session.id === 'string' ? session.id : event.id;

  await grantCredits(c.var.db, {
    userId,
    class: 'topup',
    kind: 'topup',
    amount,
    // The clock pauses while unsubscribed, so this is a floor rather than
    // a deadline — nobody loses time they were not allowed to spend.
    expiresAt: new Date(Date.now() + TOPUP_LIFETIME_MS),
    reason: 'purchase',
    sourcePlatform: 'stripe',
    sourceRef: sessionId,
    note: `Stripe top-up ${pack.storeProductId}`.slice(0, 200),
    metadata: {
      packId: pack.id,
      storeProductId: pack.storeProductId,
      credits: pack.credits,
      bonusCredits: pack.bonusCredits,
      sessionId,
    },
  });

  return `top-up ${pack.storeProductId}: +${amount} credits (${pack.credits} + ${pack.bonusCredits} bonus)`;
}

/**
 * `charge.refunded` — money went back, so credits must come back too.
 *
 * THE RULES THIS ENFORCES (see `lib/refund-policy.ts` for the why):
 *   1. Top-ups are NON-REFUNDABLE. If one is refunded anyway — a manual
 *      goodwill refund, or a card network resolving a dispute — the
 *      credits are reclaimed in full. Money back and goods kept is not an
 *      outcome we leave on the table.
 *   2. A subscription refund reclaims from SUBSCRIPTION credits only.
 *      Never top-ups, never the free welcome grant: those were paid for
 *      separately, or given, and have nothing to do with this month.
 *   3. A subscription period is only *meant* to be refunded when nothing
 *      has been spent and it is within 7 days. We cannot block a refund
 *      that already happened, so an out-of-policy one is applied and
 *      LABELLED, making "we refunded a fully-spent Ultimate month"
 *      findable in the ledger instead of invisible.
 *
 * Which wallet is decided by the payment-intent metadata the top-up route
 * writes at checkout. Subscription charges never carry it, so ABSENCE
 * means subscription — the unknown case degrades to the behaviour this
 * handler has always had rather than to something new and untested.
 */
async function applyChargeRefunded(
  c: { var: AppEnv['Variables'] },
  stripe: Stripe,
  userId: string,
  event: Stripe.Event,
): Promise<string | undefined> {
  const charge = event.data.object as Stripe.Charge;
  const refunded = charge.amount_refunded ?? 0;
  const total = charge.amount ?? 0;
  if (total <= 0 || refunded <= 0) return 'nothing refunded';

  let isTopup = false;
  let packCredits: number | null = null;

  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (piId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId);
      if (pi.metadata?.clickefy_kind === 'topup') {
        isTopup = true;
        const packId = pi.metadata?.clickefy_pack_id;
        if (packId) {
          const pack = await c.var.db.query.creditPacks.findFirst({
            where: eq(creditPacks.id, packId),
          });
          if (pack) packCredits = pack.credits + pack.bonusCredits;
        }
      }
    } catch {
      // A lookup failure must not strand the refund. Fall through to the
      // subscription path, which is the ordinary case.
    }
  }

  const share = Math.min(1, refunded / total);
  const targetClass = isTopup ? ('topup' as const) : ('subscription' as const);

  // Newest first. For a subscription this is the period being refunded —
  // the 7-day window makes any older one ineligible on its own terms. For
  // a top-up it is the pack just bought.
  const lots = await c.var.db.query.creditLots.findMany({
    where: (cl, { and: a, eq: e }) => a(e(cl.userId, userId), e(cl.class, targetClass)),
    orderBy: (cl, { desc }) => [desc(cl.createdAt)],
    limit: 10,
  });
  const live = lots.filter((l) => l.amountRemaining > 0);
  const outstanding = live.reduce((n, l) => n + l.amountRemaining, 0);

  if (isTopup) {
    // Non-refundable by policy, so any refund here is an exception. Take
    // back everything that pack still has, proportional to how much money
    // actually went back.
    if (outstanding <= 0) {
      return `TOP-UP REFUND (against policy) — nothing left to reclaim, credits already spent`;
    }
    const basis = packCredits ?? outstanding;
    const toReclaim = Math.min(outstanding, Math.floor(basis * share));
    if (toReclaim <= 0) return 'refund too small to reclaim a whole credit';

    const clawed = await revokeCredits(c.var.db, {
      userId,
      class: 'topup',
      amount: toReclaim,
      reason: 'admin_adjust',
      note: `Stripe refund ${charge.id} (top-up — against policy)`,
      metadata: {
        stripeRefund: true,
        chargeId: charge.id,
        wallet: 'topup',
        againstPolicy: true,
        policy: 'top-ups are non-refundable',
        amountRefunded: refunded,
        amountTotal: total,
        sharePct: Math.round(share * 100),
        ...(packCredits != null ? { packCredits } : {}),
      },
    });
    return `TOP-UP REFUND (against policy): reclaimed ${clawed} of ${toReclaim} credits`;
  }

  // ── Subscription ──────────────────────────────────────────────────
  const period = lots[0] ?? null;
  const verdict = evaluateSubscriptionRefund(period);

  if (outstanding <= 0) {
    // Fully spent. Nothing to take, and by policy this should never have
    // been refunded — say so plainly in the ledger note.
    return (
      `SUBSCRIPTION REFUND but nothing left to reclaim — ${verdict.summary} ` +
      `(credits already spent; refund should not have been issued)`
    );
  }

  // Scope to the period being refunded rather than every subscription lot
  // the user has ever held, so one refunded month cannot eat into another.
  const basis = period ? period.amountGranted : outstanding;
  const toReclaim = Math.min(outstanding, Math.floor(basis * share));
  if (toReclaim <= 0) return 'refund too small to reclaim a whole credit';

  const clawed = await revokeCredits(c.var.db, {
    userId,
    class: 'subscription',
    amount: toReclaim,
    reason: 'admin_adjust',
    note: `Stripe refund ${charge.id}${verdict.eligible ? '' : ' (against policy)'}`,
    metadata: {
      stripeRefund: true,
      chargeId: charge.id,
      wallet: 'subscription',
      againstPolicy: !verdict.eligible,
      policyReasons: verdict.reasons,
      creditsUsedThisPeriod: verdict.creditsUsed,
      daysSinceGrant: verdict.daysSinceGrant,
      amountRefunded: refunded,
      amountTotal: total,
      sharePct: Math.round(share * 100),
    },
  });

  // A refunded month is not a month of service, so the subscription ends
  // with it. Without this the customer keeps their plan — and the next
  // invoice would grant a fresh month of credits they have been refunded
  // for. Cancelling in STRIPE (not here) means the existing
  // `customer.subscription.deleted` handler does the teardown, keeping
  // credit forfeiture in exactly one place.
  //
  // Only on a FULL refund. A partial refund is a price adjustment or a
  // goodwill gesture, and ending someone's plan because they were given
  // $5 back would be a considerably worse outcome than the complaint that
  // prompted it.
  let cancelNote = '';
  const fullyRefunded = refunded >= total;
  if (fullyRefunded) {
    const customerId =
      typeof charge.customer === 'string' ? charge.customer : (charge.customer?.id ?? null);
    if (customerId) {
      try {
        const n = await cancelSubscriptionsForCustomer(
          stripe,
          customerId,
          `Subscription refunded in full (charge ${charge.id})`,
        );
        cancelNote = n > 0 ? ` Subscription cancelled (${n}).` : ' No live subscription to cancel.';
      } catch (err) {
        // The clawback already succeeded; a cancellation failure must not
        // make Stripe retry the whole refund and double-revoke. The hourly
        // sweep does not cover this case, so it is logged loudly instead.
        console.error('[stripe webhook] refund cancel failed', err);
        cancelNote = ' WARNING: could not cancel the subscription — cancel it manually.';
      }
    }
  }

  return (
    `subscription refund: reclaimed ${clawed} of ${toReclaim} credits ` +
    `(${Math.round(share * 100)}% of charge). ${verdict.summary}${cancelNote}`
  );
}
