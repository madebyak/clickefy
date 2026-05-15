/**
 * Admin push-broadcast surface.
 *
 *   POST /v1/admin/push/broadcast   — fan out a message to a segment.
 *   POST /v1/admin/push/preview     — dry-run: returns recipient count
 *                                     without sending.
 *
 * Targeting:
 *   - `audience: 'all'`         → every active token in the table.
 *   - `audience: 'entitlement'` → tokens whose user has the given
 *                                  entitlement (free / pro / pro_max).
 *   - `audience: 'platform'`    → ios / android only.
 *   - `audience: 'userIds'`     → explicit user-id list (max 1000).
 *
 * The handler builds the recipient list, chunks via the Expo helper,
 * marks dead tokens inactive on the way out, and writes one
 * `admin_audit_log` row via the existing middleware (free with the
 * withAdmin wrapper).
 *
 * We deliberately do NOT block the admin's response on Expo's full
 * delivery — for a 100k user blast that would tie up the Worker for
 * minutes. Instead we send the first batch synchronously (so failures
 * surface immediately) and then `c.executionCtx.waitUntil` the rest.
 * This keeps the admin UX snappy without losing observability.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray } from 'drizzle-orm';

import { deviceTokens, users } from '@clickfy/db';

import type { AppEnv } from '../types';
import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { sendExpoPush, tokensToDeactivate, type ExpoPushMessage } from '../lib/expo-push';

export const adminPushRoute = new Hono<AppEnv>();

const BroadcastSchema = z.object({
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(240),
  /** Optional deep-link / payload — surfaces in the mobile handler. */
  data: z.record(z.string(), z.unknown()).optional(),
  audience: z.discriminatedUnion('type', [
    z.object({ type: z.literal('all') }),
    z.object({ type: z.literal('entitlement'), value: z.enum(['free', 'pro', 'pro_max']) }),
    z.object({ type: z.literal('platform'), value: z.enum(['ios', 'android']) }),
    z.object({ type: z.literal('userIds'), value: z.array(z.string().uuid()).min(1).max(1000) }),
  ]),
});

async function resolveTokens(
  db: AppEnv['Variables']['db'],
  audience: z.infer<typeof BroadcastSchema>['audience'],
): Promise<Array<{ token: string; userId: string }>> {
  if (audience.type === 'all') {
    const rows = await db
      .select({ token: deviceTokens.expoPushToken, userId: deviceTokens.userId })
      .from(deviceTokens)
      .where(eq(deviceTokens.isActive, true));
    return rows;
  }

  if (audience.type === 'platform') {
    const rows = await db
      .select({ token: deviceTokens.expoPushToken, userId: deviceTokens.userId })
      .from(deviceTokens)
      .where(and(eq(deviceTokens.isActive, true), eq(deviceTokens.platform, audience.value)));
    return rows;
  }

  if (audience.type === 'entitlement') {
    const rows = await db
      .select({ token: deviceTokens.expoPushToken, userId: deviceTokens.userId })
      .from(deviceTokens)
      .innerJoin(users, eq(users.id, deviceTokens.userId))
      .where(
        and(
          eq(deviceTokens.isActive, true),
          eq(users.entitlement, audience.value),
        ),
      );
    return rows;
  }

  // audience.type === 'userIds'
  const rows = await db
    .select({ token: deviceTokens.expoPushToken, userId: deviceTokens.userId })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.isActive, true), inArray(deviceTokens.userId, audience.value)));
  return rows;
}

adminPushRoute.post(
  '/preview',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('json', BroadcastSchema),
  async (c) => {
    const { audience } = c.req.valid('json');
    const tokens = await resolveTokens(c.var.db, audience);
    return c.json({
      data: {
        recipientCount: tokens.length,
        distinctUsers: new Set(tokens.map((t) => t.userId)).size,
      },
    });
  },
);

adminPushRoute.post(
  '/broadcast',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('json', BroadcastSchema),
  async (c) => {
    const { title, body, data, audience } = c.req.valid('json');
    const recipients = await resolveTokens(c.var.db, audience);

    if (recipients.length === 0) {
      // Distinct warning code so the admin UI can surface "no devices
      // registered" instead of pretending the send succeeded. The
      // response is still 200 — the request itself was valid, there's
      // just nothing to fan out to.
      return c.json({
        data: {
          recipientCount: 0,
          firstBatch: { sent: 0, failed: 0, deactivated: 0 },
          queuedRemaining: 0,
          warning: 'no_active_devices',
        },
      });
    }

    const accessToken = c.env.EXPO_ACCESS_TOKEN;

    const messages: ExpoPushMessage[] = recipients.map((r) => ({
      to: r.token,
      title,
      body,
      data: data ?? {},
      sound: 'default',
      priority: 'high',
    }));

    // First batch synchronously so the admin sees real errors fast.
    const FIRST_BATCH = 100;
    const firstSlice = messages.slice(0, FIRST_BATCH);
    const firstTickets = await sendExpoPush(firstSlice, { accessToken });

    // Deactivate any dead tokens from the first slice.
    const firstDead = tokensToDeactivate(firstTickets);
    if (firstDead.length > 0) {
      await c.var.db
        .update(deviceTokens)
        .set({ isActive: false, updatedAt: new Date() })
        .where(inArray(deviceTokens.expoPushToken, firstDead));
    }

    const remaining = messages.slice(FIRST_BATCH);
    if (remaining.length > 0) {
      // Background the rest. waitUntil keeps the Worker alive past the
      // response, but doesn't block the admin user's response.
      c.executionCtx.waitUntil(
        (async () => {
          const tickets = await sendExpoPush(remaining, { accessToken });
          const dead = tokensToDeactivate(tickets);
          if (dead.length > 0) {
            await c.var.db
              .update(deviceTokens)
              .set({ isActive: false, updatedAt: new Date() })
              .where(inArray(deviceTokens.expoPushToken, dead));
          }
        })(),
      );
    }

    const firstOk = firstTickets.filter((t) => t.status === 'ok').length;
    const firstErr = firstTickets.length - firstOk;

    return c.json({
      data: {
        recipientCount: recipients.length,
        firstBatch: {
          sent: firstOk,
          failed: firstErr,
          deactivated: firstDead.length,
        },
        queuedRemaining: remaining.length,
      },
    });
  },
);

// ─── Self-test push (admin → admin's own devices) ───────────────────

const TestPushSchema = z
  .object({
    title: z.string().min(1).max(80).optional(),
    body: z.string().min(1).max(240).optional(),
  })
  .optional();

/**
 * POST /v1/admin/push/test
 *
 * Sends a push to every device registered to the calling admin's
 * `users.id`. Used as the "Send test to me" button on /admin/push so
 * an operator can verify the full pipeline (token → Expo → APNs/FCM
 * → device) without composing a broadcast or risking noisy fan-out.
 *
 * Returns the same shape as /broadcast for UI parity, plus a hint
 * about whether the admin has any devices registered. If the admin
 * has never signed in on a mobile device the request is rejected
 * with a clear error message — that's the most common confusion path.
 */
adminPushRoute.post(
  '/test',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('json', TestPushSchema),
  async (c) => {
    const body = c.req.valid('json') ?? {};
    const admin = c.var.user!;

    const rows = await c.var.db
      .select({ token: deviceTokens.expoPushToken, userId: deviceTokens.userId })
      .from(deviceTokens)
      .where(and(eq(deviceTokens.isActive, true), eq(deviceTokens.userId, admin.id)));

    if (rows.length === 0) {
      return c.json(
        {
          error: {
            code: 'no_device_for_admin',
            message:
              "You don't have a device registered for push. Sign in to the mobile app on a physical device first.",
          },
        },
        409,
      );
    }

    const accessToken = c.env.EXPO_ACCESS_TOKEN;
    const title = body.title ?? 'Clickefy test push';
    const text = body.body ?? `Hi ${admin.name ?? 'there'} — push is working ✅`;

    const messages: ExpoPushMessage[] = rows.map((r) => ({
      to: r.token,
      title,
      body: text,
      data: { type: 'admin_test', sentAt: new Date().toISOString() },
      sound: 'default',
      priority: 'high',
    }));

    const tickets = await sendExpoPush(messages, { accessToken });
    const dead = tokensToDeactivate(tickets);
    if (dead.length > 0) {
      await c.var.db
        .update(deviceTokens)
        .set({ isActive: false, updatedAt: new Date() })
        .where(inArray(deviceTokens.expoPushToken, dead));
    }

    const ok = tickets.filter((t) => t.status === 'ok').length;
    const failed = tickets.length - ok;
    // Surface the first error (if any) so the admin can read it in
    // the toast — Expo's error messages are usually self-explanatory
    // ('DeviceNotRegistered', 'InvalidCredentials', etc.).
    const firstError = tickets.find((t) => t.status === 'error');

    return c.json({
      data: {
        recipientCount: rows.length,
        sent: ok,
        failed,
        deactivated: dead.length,
        firstError: firstError
          ? {
              token: firstError.to.slice(0, 24) + '...',
              message: firstError.message,
              errorType: firstError.errorType,
            }
          : null,
      },
    });
  },
);

// ─── Stats: how many active devices exist right now ─────────────────

/**
 * GET /v1/admin/push/stats
 *
 * Tiny endpoint the admin UI uses to render a "0 devices registered"
 * warning banner above the broadcast composer. Saves the operator
 * from having to send a broadcast just to discover there's nothing
 * to send to.
 */
adminPushRoute.get(
  '/stats',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  async (c) => {
    const rows = await c.var.db
      .select({ token: deviceTokens.expoPushToken, platform: deviceTokens.platform })
      .from(deviceTokens)
      .where(eq(deviceTokens.isActive, true));
    const ios = rows.filter((r) => r.platform === 'ios').length;
    const android = rows.filter((r) => r.platform === 'android').length;
    return c.json({
      data: {
        totalActive: rows.length,
        ios,
        android,
        other: rows.length - ios - android,
      },
    });
  },
);
