/**
 * Clerk webhook handler — keeps Neon's `users` table in sync with Clerk.
 *
 * Configure in Clerk dashboard → Webhooks → Add endpoint:
 *   URL: https://<your-worker>/v1/webhooks/clerk
 *   Subscribe to: user.created, user.updated, user.deleted
 *
 * The signing secret (`whsec_…`) is set as `CLERK_WEBHOOK_SECRET` via
 * `wrangler secret put`. We verify every payload's Svix signature before
 * trusting it — without this, an attacker could call this endpoint
 * directly to provision admin users.
 *
 * Idempotency: we use `onConflictDoUpdate` on the unique `clerk_user_id`
 * so Clerk's at-least-once retries are safe.
 */

import { Hono } from 'hono';
import { Webhook } from 'svix';
import { eq, sql } from 'drizzle-orm';

import { creditLedger, users } from '@clickfy/db';

import type { AppEnv } from '../../types';

export const clerkWebhookRoute = new Hono<AppEnv>();

interface ClerkEmail {
  id: string;
  email_address: string;
}

interface ClerkUserData {
  id: string;
  email_addresses?: ClerkEmail[];
  primary_email_address_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string;
  username?: string | null;
}

interface ClerkEvent {
  type: 'user.created' | 'user.updated' | 'user.deleted' | string;
  data: ClerkUserData & { deleted?: boolean };
}

/** How many free credits to grant on signup. */
const SIGNUP_BONUS_CREDITS = 3;

function pickPrimaryEmail(data: ClerkUserData): string | null {
  if (!data.email_addresses?.length) return null;
  const primary = data.email_addresses.find((e) => e.id === data.primary_email_address_id);
  return (primary ?? data.email_addresses[0])?.email_address ?? null;
}

function pickName(data: ClerkUserData): string | null {
  const composed = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
  return composed || data.username || null;
}

clerkWebhookRoute.post('/', async (c) => {
  const secret = c.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return c.json(
      {
        error: {
          code: 'webhook_unconfigured',
          message:
            'CLERK_WEBHOOK_SECRET is not set. Configure the secret before pointing Clerk here.',
        },
      },
      500,
    );
  }

  const rawBody = await c.req.text();
  const headers = {
    'svix-id': c.req.header('svix-id') ?? '',
    'svix-timestamp': c.req.header('svix-timestamp') ?? '',
    'svix-signature': c.req.header('svix-signature') ?? '',
  };

  let event: ClerkEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(rawBody, headers) as ClerkEvent;
  } catch (err) {
    console.warn('[clerk webhook] signature verification failed', err);
    return c.json(
      { error: { code: 'invalid_signature', message: 'Webhook signature is invalid.' } },
      400,
    );
  }

  const data = event.data;

  if (event.type === 'user.created') {
    const email = pickPrimaryEmail(data);
    if (!email) {
      console.warn('[clerk webhook] user.created had no email', data.id);
      return c.json({ ok: true, skipped: 'no email' });
    }

    // Upsert; the lazy-create path in `withCurrentUser` may have raced.
    const [user] = await c.var.db
      .insert(users)
      .values({
        clerkUserId: data.id,
        email,
        name: pickName(data),
        avatarUrl: data.image_url ?? null,
        creditsBalance: 0,
      })
      .onConflictDoUpdate({
        target: users.clerkUserId,
        set: {
          email,
          name: pickName(data),
          avatarUrl: data.image_url ?? null,
        },
      })
      .returning();

    if (!user) {
      return c.json(
        { error: { code: 'upsert_failed', message: 'User upsert returned no row.' } },
        500,
      );
    }

    // Grant signup bonus exactly once (idempotent on retries) — the
    // ledger is our atomic guard. If the row is absent we credit + write
    // the ledger entry; if present we skip.
    const existingBonus = await c.var.db.query.creditLedger.findFirst({
      where: (cl, { and, eq: eqOp }) =>
        and(eqOp(cl.userId, user.id), eqOp(cl.reason, 'signup_bonus')),
    });

    if (!existingBonus) {
      // Bump balance and capture the new value atomically.
      const [bumped] = await c.var.db
        .update(users)
        .set({
          creditsBalance: sql`${users.creditsBalance} + ${SIGNUP_BONUS_CREDITS}`,
        })
        .where(eq(users.id, user.id))
        .returning();

      await c.var.db.insert(creditLedger).values({
        userId: user.id,
        delta: SIGNUP_BONUS_CREDITS,
        reason: 'signup_bonus',
        balanceAfter: bumped?.creditsBalance ?? SIGNUP_BONUS_CREDITS,
      });
    }

    return c.json({ ok: true, userId: user.id });
  }

  if (event.type === 'user.updated') {
    const email = pickPrimaryEmail(data);
    // Avatar reconciliation: only adopt Clerk's `image_url` if the user
    // hasn't uploaded a custom one to our R2 bucket. Avatars served via
    // `/v1/uploads/avatars/…` are user-owned and must not be clobbered by
    // a routine Clerk profile sync.
    const existing = await c.var.db.query.users.findFirst({
      where: eq(users.clerkUserId, data.id),
    });
    const isOurR2Avatar =
      !!existing?.avatarUrl && existing.avatarUrl.includes('/v1/uploads/avatars/');
    await c.var.db
      .update(users)
      .set({
        ...(email && { email }),
        name: pickName(data),
        ...(isOurR2Avatar ? {} : { avatarUrl: data.image_url ?? null }),
      })
      .where(eq(users.clerkUserId, data.id));
    return c.json({ ok: true });
  }

  if (event.type === 'user.deleted') {
    // Soft-delete: keep the row for ledger integrity, mark for purge.
    const purgeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await c.var.db
      .update(users)
      .set({ isDeleted: true, purgeAssetsAt: purgeAt })
      .where(eq(users.clerkUserId, data.id));
    return c.json({ ok: true });
  }

  return c.json({ ok: true, ignored: event.type });
});
