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
 * Event semantics (subset we care about):
 *
 *   INITIAL_PURCHASE      — first time the user buys this subscription
 *   RENEWAL               — recurring billing cycle succeeded
 *   PRODUCT_CHANGE        — user upgraded/downgraded between tiers
 *   CANCELLATION          — informational; still inside paid period
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
 *   INITIAL_PURCHASE /     → look up productId in `subscription_plans`;
 *   RENEWAL /                set entitlement + period dates; ZERO the
 *   PRODUCT_CHANGE /         user's existing `subscription_credits`
 *   UNCANCELLATION           (writing a 'subscription_reset' ledger row
 *                            if there was a balance), then grant the
 *                            plan's `credits_per_period`.
 *   EXPIRATION             → flip entitlement back to 'free'; zero out
 *                            subscription_credits (with a reset ledger
 *                            row). `topup_credits` is NOT cleared —
 *                            those credits remain on the row but become
 *                            unspendable until the user resubscribes.
 *                            CANCELLATION / BILLING_ISSUE / TRANSFER /
 *                            SUBSCRIPTION_PAUSED are recorded only.
 *
 * Idempotency:
 *
 *   - `revenuecat_events.event_id` is UNIQUE; RC's at-least-once
 *     retries dedup at insert via `onConflictDoNothing()`.
 *   - Mutations happen only on first-insert; replay short-circuits.
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

import type { AppEnv } from '../../types';

export const revenuecatWebhookRoute = new Hono<AppEnv>();

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

const SUBSCRIPTION_GRANT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
]);

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
  // should match our UUID. Pre-logIn purchases land with an
  // `$RCAnonymousID:` — recorded but not applied.
  const userRow = ev.app_user_id.startsWith('$RCAnonymousID')
    ? null
    : await c.var.db.query.users.findFirst({
        where: eq(users.id, ev.app_user_id),
      });

  // Idempotent audit insert first.
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
    return c.json({ ok: true, deduped: true });
  }

  const eventRowId = inserted[0]!.id;

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
    if (ev.type === 'NON_RENEWING_PURCHASE') {
      await applyTopupPurchase({
        db: c.var.db,
        userId: userRow.id,
        productId: ev.product_id ?? null,
        environment: ev.environment,
      });
    } else if (SUBSCRIPTION_GRANT_EVENTS.has(ev.type)) {
      await applySubscriptionGrant({
        db: c.var.db,
        userId: userRow.id,
        productId: ev.product_id ?? null,
        entitlementIdHint: ev.entitlement_id ?? ev.entitlement_ids?.[0],
        expirationMs: ev.expiration_at_ms ?? null,
        environment: ev.environment,
      });
    } else if (ev.type === 'EXPIRATION') {
      await applySubscriptionExpire({ db: c.var.db, userId: userRow.id });
    }
    // CANCELLATION, BILLING_ISSUE, TRANSFER, SUBSCRIPTION_PAUSED etc.
    // are recorded but not applied.

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
    return c.json({ ok: true, applied: false, reason: 'processing_error' });
  }
});

/**
 * NON_RENEWING_PURCHASE → grant credit-pack credits into the topup bucket.
 *
 * The pack is looked up by `store_product_id`; an unknown productId
 * means the admin hasn't registered it in `/admin/credits/packs` yet —
 * we record the event but don't mutate.
 */
async function applyTopupPurchase(args: {
  db: AppEnv['Variables']['db'];
  userId: string;
  productId: string | null;
  environment: 'SANDBOX' | 'PRODUCTION' | undefined;
}) {
  const { db, userId, productId, environment } = args;
  if (!productId) {
    throw new Error('NON_RENEWING_PURCHASE without product_id');
  }

  const pack = await db.query.creditPacks.findFirst({
    where: eq(creditPacks.storeProductId, productId),
  });
  if (!pack) {
    throw new Error(`unknown credit pack productId='${productId}' — register it in /admin/credits/packs`);
  }

  const grant = pack.credits + pack.bonusCredits;
  if (grant <= 0) return;

  const [updated] = await db
    .update(users)
    .set({
      topupCredits: sql`${users.topupCredits} + ${grant}`,
      creditsBalance: sql`${users.creditsBalance} + ${grant}`,
    })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new Error('users.update returned no row');

  await db.insert(creditLedger).values({
    userId,
    delta: grant,
    reason: 'purchase',
    balanceAfter: updated.creditsBalance,
    bucket: 'topup',
    metadata: {
      storeProductId: productId,
      credits: pack.credits,
      bonusCredits: pack.bonusCredits,
      environment: environment ?? 'PRODUCTION',
    },
    note: `RC topup ${productId} ${environment ?? 'PRODUCTION'}`.slice(0, 200),
  });
}

/**
 * Subscription grant (INITIAL / RENEWAL / PRODUCT_CHANGE / UNCANCELLATION).
 *
 * Two-step bucket update:
 *   1. Zero out any leftover `subscription_credits` from the previous
 *      period and write a `subscription_reset` ledger row (only if
 *      there was a non-zero balance — avoids ledger noise on first
 *      purchase).
 *   2. Grant the new period's `credits_per_period` into
 *      `subscription_credits` and write a `subscription_grant` row.
 *
 * Both steps adjust `credits_balance` so the denormalised sum
 * (promo + subscription + topup) stays consistent.
 */
async function applySubscriptionGrant(args: {
  db: AppEnv['Variables']['db'];
  userId: string;
  productId: string | null;
  entitlementIdHint: string | undefined;
  expirationMs: number | null;
  environment: 'SANDBOX' | 'PRODUCTION' | undefined;
}) {
  const { db, userId, productId, entitlementIdHint, expirationMs, environment } = args;

  const plan = productId
    ? await db.query.subscriptionPlans.findFirst({
        where: eq(subscriptionPlans.storeProductId, productId),
      })
    : null;

  // Entitlement: prefer the plan's setting; fall back to the RC
  // entitlement hint; final default to 'pro' so a missing plan row
  // still upgrades the user.
  const entitlement =
    plan?.entitlement === 'free'
      ? 'pro'
      : (plan?.entitlement ?? ENTITLEMENT_FROM_RC(entitlementIdHint));
  const grantCredits = plan?.creditsPerPeriod ?? 0;

  // Step 1: read current subscription_credits to know if we need a
  // reset ledger row.
  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { subscriptionCredits: true },
  });
  const leftover = currentUser?.subscriptionCredits ?? 0;

  // Step 2: apply reset + new grant in one UPDATE so the denormalised
  // sum is consistent at every observable point.
  const netDelta = grantCredits - leftover;
  const [updated] = await db
    .update(users)
    .set({
      entitlement,
      subscriptionRenewsAt: expirationMs ? new Date(expirationMs) : null,
      subscriptionExpiresAt: expirationMs ? new Date(expirationMs) : null,
      subscriptionCredits: grantCredits,
      creditsBalance: sql`${users.creditsBalance} + ${netDelta}`,
    })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new Error('users.update returned no row');

  // Step 3: ledger rows. The reset row is omitted when leftover is 0
  // to keep the audit trail tight.
  if (leftover > 0) {
    await db.insert(creditLedger).values({
      userId,
      delta: -leftover,
      reason: 'subscription_reset',
      balanceAfter: updated.creditsBalance - grantCredits,
      bucket: 'subscription',
      metadata: {
        storeProductId: productId,
        environment: environment ?? 'PRODUCTION',
      },
      note: `RC subscription reset ${productId ?? '?'} ${environment ?? 'PRODUCTION'}`.slice(0, 200),
    });
  }

  if (grantCredits > 0) {
    await db.insert(creditLedger).values({
      userId,
      delta: grantCredits,
      reason: 'subscription_grant',
      balanceAfter: updated.creditsBalance,
      bucket: 'subscription',
      metadata: {
        storeProductId: productId,
        creditsPerPeriod: grantCredits,
        environment: environment ?? 'PRODUCTION',
      },
      note: `RC ${productId ?? '?'} ${environment ?? 'PRODUCTION'}`.slice(0, 200),
    });
  }
}

/**
 * EXPIRATION → flip entitlement to 'free' and zero out subscription_credits.
 *
 * `topup_credits` is intentionally preserved on the row; the credits
 * become unspendable (the job-create CTE refuses to draw from topup
 * when `entitlement = 'free'`) but remain available the moment the
 * user resubscribes.
 */
async function applySubscriptionExpire(args: {
  db: AppEnv['Variables']['db'];
  userId: string;
}) {
  const { db, userId } = args;

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { subscriptionCredits: true },
  });
  const leftover = currentUser?.subscriptionCredits ?? 0;

  const [updated] = await db
    .update(users)
    .set({
      entitlement: 'free',
      subscriptionRenewsAt: null,
      subscriptionExpiresAt: null,
      subscriptionCredits: 0,
      creditsBalance: sql`${users.creditsBalance} - ${leftover}`,
    })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) return;

  if (leftover > 0) {
    await db.insert(creditLedger).values({
      userId,
      delta: -leftover,
      reason: 'subscription_reset',
      balanceAfter: updated.creditsBalance,
      bucket: 'subscription',
      metadata: { reason: 'expiration' },
      note: 'RC subscription expired',
    });
  }
}
