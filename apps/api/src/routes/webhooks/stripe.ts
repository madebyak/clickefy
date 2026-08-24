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

import { creditPacks, planProducts, plans, stripeEvents, users } from '@clickfy/db';
import { evaluateSubscriptionRefund } from '@clickfy/types';

import {
  TOPUP_LIFETIME_MS,
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

  return (
    `subscription refund: reclaimed ${clawed} of ${toReclaim} credits ` +
    `(${Math.round(share * 100)}% of charge). ${verdict.summary}`
  );
}
