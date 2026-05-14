/**
 * RevenueCat webhook handler.
 *
 * Configure in the RevenueCat dashboard → Project → Integrations →
 * Webhooks → New webhook:
 *   URL:    https://api.clickefy.ai/v1/webhooks/revenuecat
 *   Header: Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>
 *
 * Unlike Clerk (Svix-HMAC) or Stripe (HMAC-SHA256), RevenueCat
 * authenticates webhooks with a **static bearer token** that you set
 * yourself in the dashboard. The Worker constant-time-compares the
 * inbound `Authorization` header against the secret stored as
 * `REVENUECAT_WEBHOOK_SECRET`. Without the secret matching we 401 —
 * no DB write, no event row, nothing.
 *
 * Event semantics (subset we care about today — full reference at
 * https://www.revenuecat.com/docs/integrations/webhooks/event-types):
 *
 *   INITIAL_PURCHASE  — first time a user buys this subscription
 *   RENEWAL           — recurring billing cycle succeeded
 *   PRODUCT_CHANGE    — user upgraded/downgraded between tiers
 *   CANCELLATION      — user cancelled but still inside paid period
 *   UNCANCELLATION    — user resubscribed before period_end
 *   EXPIRATION        — paid period elapsed and was NOT renewed
 *   BILLING_ISSUE     — payment failed but grace period is active
 *   NON_RENEWING_PURCHASE — one-time credit pack (no recurrence)
 *
 * Mapping to `users`:
 *
 *   - For grant events (INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE,
 *     UNCANCELLATION) we set `entitlement` and bump credits via the
 *     ledger. Period boundaries come from `expiration_at_ms` in the
 *     event body.
 *   - For revoke events (EXPIRATION) we set `entitlement` back to
 *     'free'. We do NOT clear credits already granted — that's a
 *     UX-hostile policy.
 *   - CANCELLATION is informational only (the user still has paid
 *     access until period_end). We log it but don't change the row.
 *   - BILLING_ISSUE is informational; the actual grace-period
 *     management is owned by RC. We log it.
 *
 * Idempotency:
 *
 *   - `revenuecat_events.event_id` is UNIQUE. RC's at-least-once
 *     retries are deduped at insert time via `onConflictDoNothing()`.
 *   - The mutation on `users` happens inside the same handler call as
 *     the audit insert, so a successful return implies both ran. A
 *     replay of the same event will hit the unique-constraint short
 *     circuit and exit before re-mutating.
 */

import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';

import { creditLedger, revenuecatEvents, users } from '@clickfy/db';

import type { AppEnv } from '../../types';

export const revenuecatWebhookRoute = new Hono<AppEnv>();

/**
 * Product → credit grant mapping. When RC fires a successful purchase
 * or renewal, we add this many credits to the user's balance. Set per
 * your pricing decision — these are placeholders until the customer
 * locks pricing in App Store Connect + RC dashboard.
 *
 * Note: it's intentional that this map is local rather than a DB
 * table. Subscription tiers change rarely and are tightly coupled to
 * the App Store SKUs, so a code change + redeploy is the right
 * audit trail.
 */
const PRODUCT_CREDITS: Record<string, { credits: number; entitlement: 'pro' | 'pro_max' }> = {
  // Placeholder SKUs — update when products are created in ASC.
  clickefy_weekly: { credits: 30, entitlement: 'pro' },
  clickefy_monthly: { credits: 120, entitlement: 'pro' },
  clickefy_yearly: { credits: 1500, entitlement: 'pro' },
};

const ENTITLEMENT_FROM_RC = (rcId: string | undefined): 'pro' | 'pro_max' => {
  if (rcId === 'Clickefy.Ai Pro Max') return 'pro_max';
  return 'pro';
};

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
    /** RC's internal id for the customer; usually identical to app_user_id once we logIn(). */
    original_app_user_id?: string;
    product_id?: string;
    entitlement_id?: string;
    entitlement_ids?: string[];
    expiration_at_ms?: number | null;
    purchased_at_ms?: number;
    price_in_purchased_currency?: number;
    currency?: string;
    environment?: 'SANDBOX' | 'PRODUCTION';
    subscriber_attributes?: Record<string, RcSubscriberAttribute>;
  };
  api_version?: string;
}

const GRANT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
]);

const REVOKE_EVENTS = new Set(['EXPIRATION']);

/**
 * Constant-time string compare. Avoids early-exit timing leaks that
 * could let an attacker brute-force the secret one byte at a time —
 * we're a tiny target, but treating the comparison correctly is
 * cheaper than explaining later why we didn't.
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

  // Try to resolve `app_user_id` to an internal users row. On the
  // mobile side we call `Purchases.logIn(user.id)` after Clerk auth
  // resolves, so RC stamps every event with our internal UUID. If a
  // user purchased BEFORE we wired logIn() they'll have RC's
  // auto-generated `$RCAnonymousID:…` instead — those are recorded but
  // not applied (`userId` stays null and an operator can reconcile
  // later via the admin queue).
  const userRow = ev.app_user_id.startsWith('$RCAnonymousID')
    ? null
    : await c.var.db.query.users.findFirst({
        where: eq(users.id, ev.app_user_id),
      });

  // Audit row first — even on processing failure we keep a record.
  // Insert with onConflictDoNothing so RC retries are idempotent: if
  // the event was already recorded (and processed) we return 200
  // immediately. Otherwise we continue to the mutation.
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

  if (inserted.length === 0) {
    // Duplicate delivery — already on file. RC expects 2xx so it stops
    // retrying, and we don't re-apply.
    return c.json({ ok: true, deduped: true });
  }

  const eventRowId = inserted[0]!.id;

  // No matching user? Record it; operators can reconcile from the
  // admin queue (typically by logging in on mobile to fire a follow-up
  // `Purchases.logIn(internalId)` that links the RC customer to us).
  if (!userRow) {
    await c.var.db
      .update(revenuecatEvents)
      .set({
        processedAt: new Date(),
        processingError: 'app_user_id does not match any internal user',
      })
      .where(eq(revenuecatEvents.id, eventRowId));
    return c.json({ ok: true, applied: false, reason: 'unmatched_user' });
  }

  try {
    if (GRANT_EVENTS.has(ev.type)) {
      await applyGrant({
        db: c.var.db,
        userId: userRow.id,
        productId: ev.product_id ?? null,
        entitlementId: ev.entitlement_id ?? ev.entitlement_ids?.[0],
        expirationMs: ev.expiration_at_ms ?? null,
        environment: ev.environment,
      });
    } else if (REVOKE_EVENTS.has(ev.type)) {
      await applyRevoke({ db: c.var.db, userId: userRow.id });
    }
    // CANCELLATION, BILLING_ISSUE, TRANSFER, SUBSCRIPTION_PAUSED etc.
    // are recorded but not applied — they're informational for the
    // current schema.

    await c.var.db
      .update(revenuecatEvents)
      .set({ processedAt: new Date() })
      .where(eq(revenuecatEvents.id, eventRowId));

    return c.json({ ok: true, applied: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rc webhook] processing failed', err);
    await c.var.db
      .update(revenuecatEvents)
      .set({ processedAt: new Date(), processingError: message })
      .where(eq(revenuecatEvents.id, eventRowId));
    // Return 200 anyway so RC stops retrying — we have the event on
    // file and an operator will action it from the admin queue.
    return c.json({ ok: true, applied: false, reason: 'processing_error' });
  }
});

async function applyGrant(args: {
  db: AppEnv['Variables']['db'];
  userId: string;
  productId: string | null;
  entitlementId: string | undefined;
  expirationMs: number | null;
  environment: 'SANDBOX' | 'PRODUCTION' | undefined;
}) {
  const { db, userId, productId, entitlementId, expirationMs, environment } = args;

  const mapping = productId ? PRODUCT_CREDITS[productId] : undefined;
  const entitlement = entitlementId ? ENTITLEMENT_FROM_RC(entitlementId) : (mapping?.entitlement ?? 'pro');
  const grantCredits = mapping?.credits ?? 0;

  // Set entitlement + period dates first (atomic with the credit bump
  // below via SQL — Neon's serverless driver lacks true multi-statement
  // tx support so we sequence carefully).
  const [updated] = await db
    .update(users)
    .set({
      entitlement,
      subscriptionRenewsAt: expirationMs ? new Date(expirationMs) : null,
      subscriptionExpiresAt: expirationMs ? new Date(expirationMs) : null,
      creditsBalance: sql`${users.creditsBalance} + ${grantCredits}`,
    })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) {
    throw new Error('users.update returned no row');
  }

  if (grantCredits > 0) {
    await db.insert(creditLedger).values({
      userId,
      delta: grantCredits,
      reason: 'subscription_grant',
      balanceAfter: updated.creditsBalance,
      note: `RC ${productId ?? '?'} ${environment ?? 'PRODUCTION'}`.slice(0, 200),
    });
  }
}

async function applyRevoke(args: { db: AppEnv['Variables']['db']; userId: string }) {
  // We don't strip credits — already-granted credits remain spendable.
  // Pure entitlement downgrade.
  await args.db
    .update(users)
    .set({
      entitlement: 'free',
      subscriptionRenewsAt: null,
      subscriptionExpiresAt: null,
    })
    .where(eq(users.id, args.userId));
}
