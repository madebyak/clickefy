/**
 * RevenueCat webhook handler.
 *
 * Configure in the RevenueCat dashboard → Project → Integrations →
 * Webhooks → New webhook:
 *   URL:    https://api.clickefy.ai/v1/webhooks/revenuecat
 *   Header: Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>
 *
 * Auth model: RC uses a STATIC bearer token rather than HMAC. We
 * constant-time-compare the inbound header against
 * `REVENUECAT_WEBHOOK_SECRET`.
 *
 * Event semantics (subset we act on):
 *
 *   INITIAL_PURCHASE      — first time the user buys this subscription
 *   RENEWAL               — recurring billing cycle succeeded
 *   PRODUCT_CHANGE        — user upgraded/downgraded between tiers
 *   CANCELLATION          — auto-renew turned off; ALSO how refunds
 *                           arrive (cancel_reason = CUSTOMER_SUPPORT)
 *   UNCANCELLATION        — user resubscribed before period_end
 *   EXPIRATION            — paid period elapsed; NOT renewed
 *   BILLING_ISSUE         — payment failed; grace-period managed by RC
 *   NON_RENEWING_PURCHASE — one-time consumable (credit pack)
 *
 * Bucket routing:
 *
 *   NON_RENEWING_PURCHASE  → look up productId in `credit_packs`;
 *                            grant `credits + bonus_credits` to the
 *                            `topup_credits` bucket. Never resets.
 *   INITIAL_PURCHASE /     → look up productId in `subscription_plans`
 *   RENEWAL /                (REQUIRED — unknown products are rejected,
 *   PRODUCT_CHANGE /         never defaulted to Pro); set entitlement +
 *   UNCANCELLATION           period dates; reset `subscription_credits`
 *                            to the plan's `credits_per_period` in ONE
 *                            atomic statement.
 *   EXPIRATION             → flip entitlement back to 'free' — but only
 *                            when the event isn't stale (guarded against
 *                            the upgrade race where the OLD plan's
 *                            EXPIRATION arrives after the NEW plan's
 *                            PRODUCT_CHANGE). `topup_credits` is NOT
 *                            cleared — unspendable until resubscribe.
 *   CANCELLATION           → cancel_reason CUSTOMER_SUPPORT = refund:
 *                            claw back the pack's credits (packs) or
 *                            expire immediately (subscriptions). Other
 *                            reasons are recorded only.
 *
 * Idempotency & retries:
 *
 *   - `revenuecat_events.event_id` is UNIQUE. A replay of a
 *     SUCCESSFULLY processed event short-circuits (`deduped`).
 *   - A replay of a FAILED event re-processes it: on failure we record
 *     `processing_error` but leave `processed_at` NULL and return 500,
 *     so RC's retry schedule keeps re-driving the event until it lands
 *     (e.g. ops registers a missing product row). This is what makes a
 *     transient DB blip or a missing catalog row recoverable instead of
 *     a permanently lost paid grant.
 *
 * Sandbox:
 *
 *   TestFlight / sandbox purchases arrive with environment=SANDBOX.
 *   They are applied only while `RC_ALLOW_SANDBOX = "true"` (the
 *   TestFlight testing phase). At public launch the flag is flipped
 *   off and sandbox events are recorded but never grant anything —
 *   otherwise testers could farm real credits (sandbox renewals run
 *   on an accelerated clock).
 */

import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';

import {
  creditLedger,
  creditPacks,
  revenuecatEvents,
  subscriptionPlans,
  users,
} from '@clickfy/db';

import {
  closeSubscriptionLots,
  grantCredits,
  pauseTopupClocks,
  resumeTopupClocks,
  revokeCredits,
} from '../../lib/credit-grants';
import type { AppEnv } from '../../types';

export const revenuecatWebhookRoute = new Hono<AppEnv>();

interface RcSubscriberAttribute {
  value: string;
  updated_at_ms: number;
}

interface RcEventBody {
  event: {
    id: string;
    type: string;
    event_timestamp_ms: number;
    app_user_id: string;
    original_app_user_id?: string;
    product_id?: string;
    entitlement_id?: string;
    entitlement_ids?: string[];
    expiration_at_ms?: number | null;
    purchased_at_ms?: number;
    price_in_purchased_currency?: number;
    currency?: string;
    /** UNSUBSCRIBE | BILLING_ERROR | DEVELOPER_INITIATED | PRICE_INCREASE | CUSTOMER_SUPPORT | UNKNOWN */
    cancel_reason?: string;
    environment?: 'SANDBOX' | 'PRODUCTION';
    subscriber_attributes?: Record<string, RcSubscriberAttribute>;
  };
  api_version?: string;
}

const SUBSCRIPTION_GRANT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
]);

/**
 * How long a bought credit pack lives. Deliberately gentler than the
 * 90 days Higgsfield uses, because we sell through Apple and Google where
 * "my credits vanished" is a one-tap refund and a review risk. The clock
 * also pauses while the user is unsubscribed.
 */
const TOPUP_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Constant-time string compare. Avoids early-exit timing leaks that
 * could let an attacker brute-force the secret one byte at a time.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

revenuecatWebhookRoute.post('/', async (c) => {
  const secret = c.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) {
    return c.json(
      {
        error: {
          code: 'webhook_unconfigured',
          message:
            'REVENUECAT_WEBHOOK_SECRET is not set. Configure the secret before pointing RC here.',
        },
      },
      500,
    );
  }

  const authHeader = c.req.header('authorization') ?? '';
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!presented || !safeEqual(presented, secret)) {
    console.warn('[rc webhook] auth failed');
    return c.json(
      { error: { code: 'invalid_signature', message: 'Webhook authorisation is invalid.' } },
      401,
    );
  }

  let body: RcEventBody;
  try {
    body = (await c.req.json()) as RcEventBody;
  } catch {
    return c.json({ error: { code: 'bad_json', message: 'Body is not valid JSON.' } }, 400);
  }

  const ev = body?.event;
  if (!ev?.id || !ev?.type || !ev?.app_user_id || !ev?.event_timestamp_ms) {
    return c.json(
      { error: { code: 'malformed_event', message: 'Required event fields missing.' } },
      400,
    );
  }

  // Resolve `app_user_id` to our internal user. Mobile calls
  // `Purchases.logIn(user.id)` after Clerk resolves, so `app_user_id`
  // should be our UUID. `$RCAnonymousID:` (pre-logIn) and any other
  // non-UUID shape can NEVER match — skip the lookup entirely so a
  // stray value can't crash the uuid cast outside the try/catch.
  const isMatchableId = UUID_RE.test(ev.app_user_id);
  const userRow = isMatchableId
    ? await c.var.db.query.users.findFirst({ where: eq(users.id, ev.app_user_id) })
    : null;

  // Sandbox gate. During the TestFlight phase RC_ALLOW_SANDBOX="true"
  // lets test purchases exercise the full grant path; at public launch
  // the flag is removed and sandbox events are recorded but inert.
  const sandboxAllowed = c.env.RC_ALLOW_SANDBOX === 'true';
  const isSandbox = ev.environment === 'SANDBOX';

  // Idempotent audit insert. `onConflictDoNothing` means exactly one
  // delivery wins the insert even under concurrent duplicates.
  const inserted = await c.var.db
    .insert(revenuecatEvents)
    .values({
      eventId: ev.id,
      eventType: ev.type,
      appUserId: ev.app_user_id,
      userId: userRow?.id ?? null,
      productId: ev.product_id ?? null,
      entitlementId: ev.entitlement_id ?? ev.entitlement_ids?.[0] ?? null,
      payload: body as unknown as Record<string, unknown>,
      eventOccurredAt: new Date(ev.event_timestamp_ms),
    })
    .onConflictDoNothing({ target: revenuecatEvents.eventId })
    .returning();

  // Dedupe is PROCESSING-STATE-AWARE: a replay short-circuits only if
  // the prior attempt actually completed (`processed_at` set). A replay
  // of a failed attempt falls through and re-processes — this is RC's
  // retry schedule doing its job.
  let eventRowId: string;
  if (inserted.length > 0) {
    eventRowId = inserted[0]!.id;
  } else {
    const existing = await c.var.db.query.revenuecatEvents.findFirst({
      where: eq(revenuecatEvents.eventId, ev.id),
      columns: { id: true, processedAt: true },
    });
    if (!existing) {
      // Insert conflicted but the row is invisible — transient; let RC retry.
      return c.json({ error: { code: 'transient', message: 'Retry.' } }, 503);
    }
    if (existing.processedAt) {
      return c.json({ ok: true, deduped: true });
    }
    eventRowId = existing.id; // failed earlier — re-process now
  }

  const markProcessed = (note?: string) =>
    c.var.db
      .update(revenuecatEvents)
      .set({ processedAt: new Date(), processingError: note ?? null })
      .where(eq(revenuecatEvents.id, eventRowId));

  if (isSandbox && !sandboxAllowed) {
    await markProcessed('sandbox_ignored (RC_ALLOW_SANDBOX is off)');
    return c.json({ ok: true, applied: false, reason: 'sandbox_ignored' });
  }

  if (!userRow) {
    if (!isMatchableId) {
      // Anonymous / non-UUID id — a retry redelivers the same id, so
      // retrying is futile. Record and close out.
      await markProcessed('app_user_id is not a matchable internal user id');
      return c.json({ ok: true, applied: false, reason: 'unmatched_user' });
    }
    // Valid UUID with no row (user not provisioned yet). Leave the
    // event unprocessed and ask RC to retry — provisioning usually
    // lands within seconds.
    await c.var.db
      .update(revenuecatEvents)
      .set({ processingError: 'user not found (provisioning lag?) — retrying' })
      .where(eq(revenuecatEvents.id, eventRowId));
    return c.json({ error: { code: 'user_not_found', message: 'Retry.' } }, 503);
  }

  try {
    let note: string | undefined;

    if (ev.type === 'NON_RENEWING_PURCHASE') {
      await applyTopupPurchase({
        db: c.var.db,
        userId: userRow.id,
        productId: ev.product_id ?? null,
        environment: ev.environment,
        eventId: ev.id,
      });
    } else if (SUBSCRIPTION_GRANT_EVENTS.has(ev.type)) {
      note = await applySubscriptionGrant({
        db: c.var.db,
        userId: userRow.id,
        productId: ev.product_id ?? null,
        expirationMs: ev.expiration_at_ms ?? null,
        environment: ev.environment,
        eventId: ev.id,
      });
    } else if (ev.type === 'EXPIRATION') {
      note = await applySubscriptionExpire({
        db: c.var.db,
        userId: userRow.id,
        // Stale-event guard: an EXPIRATION whose expiry predates the
        // user's current period end is the OLD plan of an upgrade —
        // it must not downgrade the newer plan.
        eventExpirationMs: ev.expiration_at_ms ?? ev.event_timestamp_ms,
        force: false,
      });
    } else if (ev.type === 'CANCELLATION' && ev.cancel_reason === 'CUSTOMER_SUPPORT') {
      // CUSTOMER_SUPPORT cancellation = Apple/Google issued a REFUND.
      note = await applyRefundClawback({
        db: c.var.db,
        userId: userRow.id,
        productId: ev.product_id ?? null,
        environment: ev.environment,
      });
    }
    // Other CANCELLATION reasons, BILLING_ISSUE, TRANSFER,
    // SUBSCRIPTION_PAUSED etc. are recorded but not applied.

    await markProcessed(note);
    return c.json({ ok: true, applied: true, ...(note ? { note } : {}) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rc webhook] processing failed', err);
    // Record the error but leave `processed_at` NULL and return 500 —
    // RC retries on its schedule and the state-aware dedupe above lets
    // the retry actually re-process. A paid grant is never lost to a
    // one-off failure or a not-yet-registered product row.
    await c.var.db
      .update(revenuecatEvents)
      .set({ processingError: message })
      .where(eq(revenuecatEvents.id, eventRowId));
    return c.json(
      { error: { code: 'processing_error', message: 'Processing failed; retry.' } },
      500,
    );
  }
});

/**
 * NON_RENEWING_PURCHASE → grant credit-pack credits into the topup bucket.
 *
 * The pack is looked up by `store_product_id`; an unknown productId
 * throws → 500 → RC retries until the admin registers the pack in
 * `/admin/credits/packs`, at which point the retry grants normally.
 */
async function applyTopupPurchase(args: {
  db: AppEnv['Variables']['db'];
  userId: string;
  productId: string | null;
  environment: 'SANDBOX' | 'PRODUCTION' | undefined;
  eventId: string;
}) {
  const { db, userId, productId, environment, eventId } = args;
  if (!productId) {
    throw new Error('NON_RENEWING_PURCHASE without product_id');
  }

  const pack = await db.query.creditPacks.findFirst({
    where: eq(creditPacks.storeProductId, productId),
  });
  if (!pack) {
    throw new Error(
      `unknown credit pack productId='${productId}' — register it in /admin/credits/packs`,
    );
  }

  const grant = pack.credits + pack.bonusCredits;
  if (grant <= 0) return;

  // Top-ups expire 12 months from purchase, and the clock is paused while
  // the user is unsubscribed (see `pauseTopupClocks`) so they never lose
  // time they could not spend.
  const expiresAt = new Date(Date.now() + TOPUP_LIFETIME_MS);

  await grantCredits(db, {
    userId,
    class: 'topup',
    kind: 'topup',
    amount: grant,
    expiresAt,
    reason: 'purchase',
    sourcePlatform: environment === 'SANDBOX' ? 'sandbox' : 'app_store',
    // The RC event id makes a redelivery a no-op at the database level,
    // on top of the handler's own dedupe.
    sourceRef: eventId,
    note: `RC topup ${productId} ${environment ?? 'PRODUCTION'}`.slice(0, 200),
    metadata: {
      storeProductId: productId,
      credits: pack.credits,
      bonusCredits: pack.bonusCredits,
      environment: environment ?? 'PRODUCTION',
    },
  });
}

/**
 * Subscription grant (INITIAL / RENEWAL / PRODUCT_CHANGE / UNCANCELLATION).
 *
 * The plan row is REQUIRED and must carry a paid entitlement — an
 * unknown product or a misconfigured plan throws (→ RC retry) instead
 * of silently granting Pro, which is how a missing catalog row used to
 * mint free Pro with a zero credit allowance.
 *
 * Bucket update is ONE atomic statement: `subscription_credits` is set
 * absolutely while `credits_balance` is adjusted relative to the SAME
 * row's current values (`- subscription_credits + grant`), so the
 * `users_balance_matches_buckets` CHECK holds even when a generation
 * debit lands concurrently. The old balance for the ledger's reset row
 * comes back via a self-join RETURNING.
 */
async function applySubscriptionGrant(args: {
  db: AppEnv['Variables']['db'];
  userId: string;
  productId: string | null;
  expirationMs: number | null;
  environment: 'SANDBOX' | 'PRODUCTION' | undefined;
  eventId: string;
}): Promise<string | undefined> {
  const { db, userId, productId, expirationMs, environment, eventId } = args;

  if (!productId) throw new Error('subscription event without product_id');

  const plan = await db.query.subscriptionPlans.findFirst({
    where: eq(subscriptionPlans.storeProductId, productId),
  });
  if (!plan) {
    throw new Error(
      `unknown subscription productId='${productId}' — register it in /admin/credits/subscriptions`,
    );
  }
  if (plan.entitlement === 'free' || plan.entitlement === 'admin') {
    throw new Error(
      `plan '${productId}' has non-paid entitlement '${plan.entitlement}' — fix the catalog row`,
    );
  }

  // Stale-event guard: a delayed grant whose period already ended must not
  // re-upgrade an expired user (the twin of the EXPIRATION guard).
  if (expirationMs !== null && expirationMs <= Date.now()) {
    return 'skipped_stale_grant (period already over)';
  }

  const periodEnd = expirationMs ? new Date(expirationMs) : null;

  // Use-it-or-lose-it: the previous period's unspent allowance is
  // forfeited before the new one is issued.
  const forfeited = await closeSubscriptionLots(
    db,
    userId,
    `RC subscription reset ${productId} ${environment ?? 'PRODUCTION'}`.slice(0, 200),
  );

  await db
    .update(users)
    .set({
      entitlement: plan.entitlement,
      subscriptionRenewsAt: periodEnd,
      subscriptionExpiresAt: periodEnd,
    })
    .where(eq(users.id, userId));

  // The new period's credits, expiring when the period does — which is
  // what puts them first in the spend order.
  await grantCredits(db, {
    userId,
    class: 'subscription',
    kind: 'subscription',
    amount: plan.creditsPerPeriod,
    expiresAt: periodEnd,
    reason: 'subscription_grant',
    sourcePlatform: environment === 'SANDBOX' ? 'sandbox' : 'app_store',
    sourceRef: eventId,
    note: `RC ${productId} ${environment ?? 'PRODUCTION'}`.slice(0, 200),
    metadata: {
      storeProductId: productId,
      creditsPerPeriod: plan.creditsPerPeriod,
      environment: environment ?? 'PRODUCTION',
    },
  });

  // Back in good standing — restart any top-up clock frozen by a lapse.
  const resumed = await resumeTopupClocks(db, userId);

  const notes: string[] = [];
  if (forfeited > 0) notes.push(`forfeited ${forfeited} unspent`);
  if (resumed > 0) notes.push(`resumed ${resumed} topup clock(s)`);
  return notes.length > 0 ? notes.join('; ') : undefined;
}

/**
 * EXPIRATION → flip entitlement to 'free' and zero out subscription_credits.
 *
 * Atomic single statement (same self-join pattern as the grant) plus a
 * monotonicity guard: the UPDATE only fires when the event's expiry is
 * at or after the user's current `subscription_expires_at`. In the
 * upgrade race (old plan's EXPIRATION arriving after the new plan's
 * PRODUCT_CHANGE), the user's period end is already later than the old
 * plan's expiry → 0 rows → skip, and the paying customer keeps Pro.
 *
 * `force` (refund path) drops the guard — a refunded subscription is
 * revoked immediately regardless of period end.
 *
 * `topup_credits` is intentionally preserved: unspendable while free,
 * available again on resubscribe.
 */
async function applySubscriptionExpire(args: {
  db: AppEnv['Variables']['db'];
  userId: string;
  eventExpirationMs: number;
  force: boolean;
}): Promise<string | undefined> {
  const { db, userId, eventExpirationMs, force } = args;

  // Monotonicity guard: an EXPIRATION whose expiry predates the user's
  // current period end is the OLD plan of an upgrade and must not
  // downgrade the newer one. `force` (refund) drops the guard.
  const guard = force
    ? sql``
    : sql`AND (users.subscription_expires_at IS NULL OR users.subscription_expires_at <= ${new Date(eventExpirationMs)})`;

  const result = await db.execute<{ id: string }>(sql`
    UPDATE users SET
      entitlement = 'free',
      subscription_renews_at = NULL,
      subscription_expires_at = NULL
    WHERE users.id = ${userId}::uuid
      AND users.entitlement <> 'admin'
      ${guard}
    RETURNING users.id
  `);
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  if (rows.length === 0) {
    return 'skipped_superseded (a newer subscription period is active)';
  }

  // The period's unspent allowance is forfeited.
  const forfeited = await closeSubscriptionLots(
    db,
    userId,
    force ? 'RC subscription refunded' : 'RC subscription expired',
  );

  // Top-ups survive but become unspendable, so their 12-month clock is
  // frozen rather than burning time the user cannot use. This is the whole
  // point of the pausing model — without it, cancelling for six months
  // would silently eat half the life of a pack they paid for.
  const paused = await pauseTopupClocks(db, userId);

  const notes: string[] = [];
  if (forfeited > 0) notes.push(`forfeited ${forfeited} unspent`);
  if (paused > 0) notes.push(`paused ${paused} topup clock(s)`);
  return notes.length > 0 ? notes.join('; ') : undefined;
}

/**
 * Refund clawback (CANCELLATION with cancel_reason=CUSTOMER_SUPPORT).
 *
 *   Credit pack  → remove the pack's granted credits from the topup
 *                  bucket, clamped at the current topup balance (never
 *                  drives a bucket negative; if they already spent the
 *                  credits, we absorb the difference).
 *   Subscription → revoke Pro immediately (forced expire).
 *
 * Unknown product → throw → RC retries until the catalog row exists.
 */
async function applyRefundClawback(args: {
  db: AppEnv['Variables']['db'];
  userId: string;
  productId: string | null;
  environment: 'SANDBOX' | 'PRODUCTION' | undefined;
}): Promise<string | undefined> {
  const { db, userId, productId, environment } = args;
  if (!productId) throw new Error('CUSTOMER_SUPPORT cancellation without product_id');

  const pack = await db.query.creditPacks.findFirst({
    where: eq(creditPacks.storeProductId, productId),
  });
  if (pack) {
    const grant = pack.credits + pack.bonusCredits;
    if (grant <= 0) return 'refund_noop (zero-credit pack)';

    // Clamped at what is actually left: if they already spent the credits
    // we absorb the difference rather than pushing them negative, which
    // the balance CHECK would reject anyway.
    const clawed = await revokeCredits(db, {
      userId,
      class: 'topup',
      amount: grant,
      reason: 'admin_adjust',
      note: `RC refund clawback ${productId}`.slice(0, 200),
      metadata: {
        rcRefund: true,
        storeProductId: productId,
        packGrant: grant,
        environment: environment ?? 'PRODUCTION',
      },
    });
    return `refund_clawback (${clawed} of ${grant} credits reclaimed)`;
  }

  const plan = await db.query.subscriptionPlans.findFirst({
    where: eq(subscriptionPlans.storeProductId, productId),
  });
  if (plan) {
    await applySubscriptionExpire({
      db,
      userId,
      eventExpirationMs: Date.now(),
      force: true,
    });
    return 'refund_expire (subscription revoked)';
  }

  throw new Error(`refund for unknown productId='${productId}' — register it in /admin/credits`);
}
