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
      return c.json({
        data: {
          sent: 0,
          failed: 0,
          recipientCount: 0,
          deactivated: 0,
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
