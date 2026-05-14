/**
 * Device push-token registry.
 *
 * Mobile flow:
 *   1. On every cold start (after sign-in), the app calls
 *      `Notifications.getExpoPushTokenAsync()` and POSTs the result
 *      here. Idempotent — same token + same user is a no-op.
 *   2. On sign-out, mobile calls DELETE to unbind the device from
 *      this user. The token row is removed entirely, not just
 *      flipped to inactive, because the next user to sign in on this
 *      device should NOT inherit any state from the previous owner.
 *
 * We rely on UNIQUE(`expo_push_token`) so an upsert keyed on the
 * token reassigns ownership when a device hands off between users.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';

import { deviceTokens } from '@clickfy/db';

import type { AppEnv } from '../types';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';

export const devicesRoute = new Hono<AppEnv>();

const RegisterSchema = z.object({
  /** ExponentPushToken[...] — Expo's opaque device token. */
  expoPushToken: z
    .string()
    .min(10)
    .max(200)
    .regex(/^Expo(?:nent)?PushToken\[.+\]$/, 'Not an Expo push token'),
  platform: z.enum(['ios', 'android', 'unknown']).default('unknown'),
  appVersion: z.string().max(40).optional(),
  locale: z.string().max(16).optional(),
});

const UnregisterSchema = z.object({
  expoPushToken: z.string().min(10).max(200),
});

devicesRoute.post(
  '/register',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  zValidator('json', RegisterSchema),
  async (c) => {
    const user = c.var.user;
    if (!user) {
      return c.json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } }, 401);
    }

    const { expoPushToken, platform, appVersion, locale } = c.req.valid('json');

    // Upsert by token, reassigning ownership if it was registered by a
    // different user. This is the device-handoff case (sign-out then
    // sign-in on the same device).
    const [row] = await c.var.db
      .insert(deviceTokens)
      .values({
        userId: user.id,
        expoPushToken,
        platform,
        appVersion: appVersion ?? null,
        locale: locale ?? null,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: deviceTokens.expoPushToken,
        set: {
          userId: user.id,
          platform,
          appVersion: appVersion ?? null,
          locale: locale ?? null,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();

    return c.json({ data: { id: row?.id, ok: true } });
  },
);

devicesRoute.post(
  '/unregister',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  zValidator('json', UnregisterSchema),
  async (c) => {
    const user = c.var.user;
    if (!user) {
      return c.json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } }, 401);
    }

    const { expoPushToken } = c.req.valid('json');

    // Scope the delete to the current user. If another user has since
    // claimed this token (unlikely but possible during a fast handoff)
    // we leave their row intact.
    await c.var.db
      .delete(deviceTokens)
      .where(and(eq(deviceTokens.expoPushToken, expoPushToken), eq(deviceTokens.userId, user.id)));

    return c.json({ data: { ok: true } });
  },
);
