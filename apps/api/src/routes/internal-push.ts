/**
 * Internal push fan-out endpoint.
 *
 * Called by the jobs-worker when a generation finishes (success or
 * failure) to ping the owning user. Lives behind the same
 * `INTERNAL_API_SECRET` as the outputs write route — the secret is a
 * Worker secret + jobs-worker env var, never exposed to the mobile
 * client.
 *
 * Why send via the Worker instead of the jobs-worker hitting Expo
 * directly:
 *   - One place owns the device_tokens table; the jobs-worker doesn't
 *     need Drizzle bindings.
 *   - DeviceNotRegistered cleanup lives next to the table.
 *   - Same auth + observability surface as /v1/admin/push.
 *
 * Route: POST /v1/internal/push/user
 * Body: { userId: uuid, title, body, data? }
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { deviceTokens, notifications } from '@clickfy/db';

import type { AppEnv } from '../types';
import { sendExpoPush, tokensToDeactivate, type ExpoPushMessage } from '../lib/expo-push';

export const internalPushRoute = new Hono<AppEnv>();

const UserPushSchema = z.object({
  userId: z.string().uuid(),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(240),
  data: z.record(z.string(), z.unknown()).optional(),
});

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) {
    r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return r === 0;
}

internalPushRoute.post('/user', zValidator('json', UserPushSchema), async (c) => {
  const secret = c.env.INTERNAL_API_SECRET;
  if (!secret) {
    return c.json(
      { error: { code: 'not_configured', message: 'INTERNAL_API_SECRET missing on Worker.' } },
      503,
    );
  }
  const provided = c.req.header('x-internal-secret');
  if (!provided || !timingSafeEq(provided, secret)) {
    return c.json({ error: { code: 'unauthorized', message: 'Invalid internal secret.' } }, 401);
  }

  const { userId, title, body, data } = c.req.valid('json');

  // ── Record the in-app inbox notification ───────────────────────────
  // Independent of push delivery: the user should see it in-app even with
  // push disabled / no tokens. Best-effort — a failure here must never
  // block the actual push. Capped at the latest 30 per user (pruned here).
  const notifType: 'job_completed' | 'job_failed' | 'system' =
    data?.type === 'job_completed'
      ? 'job_completed'
      : data?.type === 'job_failed'
        ? 'job_failed'
        : 'system';
  try {
    await c.var.db
      .insert(notifications)
      .values({ userId, type: notifType, title, body, data: data ?? null });
    await c.var.db.execute(sql`
      DELETE FROM notifications
      WHERE user_id = ${userId}::uuid
        AND id NOT IN (
          SELECT id FROM notifications
          WHERE user_id = ${userId}::uuid
          ORDER BY created_at DESC
          LIMIT 30
        )
    `);
  } catch (err) {
    console.error('notification insert failed:', err);
  }

  const rows = await c.var.db
    .select({ token: deviceTokens.expoPushToken })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.isActive, true)));

  if (rows.length === 0) {
    return c.json({ data: { ok: true, sent: 0, reason: 'no_active_tokens' } });
  }

  const messages: ExpoPushMessage[] = rows.map((r) => ({
    to: r.token,
    title,
    body,
    data: data ?? {},
    sound: 'default',
    priority: 'high',
  }));

  const tickets = await sendExpoPush(messages, { accessToken: c.env.EXPO_ACCESS_TOKEN });
  const dead = tokensToDeactivate(tickets);
  if (dead.length > 0) {
    await c.var.db
      .update(deviceTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(inArray(deviceTokens.expoPushToken, dead));
  }

  const okCount = tickets.filter((t) => t.status === 'ok').length;
  return c.json({
    data: { ok: true, sent: okCount, failed: tickets.length - okCount, deactivated: dead.length },
  });
});
