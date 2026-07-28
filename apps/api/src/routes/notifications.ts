/**
 * /v1/notifications — the in-app notification inbox for the current user.
 *
 *   GET    /v1/notifications           list (newest first, ≤30) + unreadCount
 *   POST   /v1/notifications/read-all  mark every unread notification read
 *   POST   /v1/notifications/:id/read  mark one read (on tap)
 *   DELETE /v1/notifications           clear the whole inbox
 *
 * Rows are written at the push chokepoint (`/v1/internal/push/user`) and
 * capped at 30 per user there, so this route never needs to paginate.
 *
 * Auth: required; every query is scoped to `c.var.user.id`, so a caller
 * can only ever see / mutate their own notifications.
 */

import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { notifications } from '@clickfy/db';

import type { AppEnv } from '../types';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';

export const notificationsRoute = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── GET /v1/notifications ──────────────────────────────────────────
notificationsRoute.get(
  '/',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const user = c.var.user;
    if (!user) {
      return c.json({ error: { code: 'unauthenticated', message: 'Sign in required.' } }, 401);
    }

    const rows = await c.var.db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        data: notifications.data,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(30);

    const items = rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      data: r.data ?? undefined,
      read: r.readAt !== null,
      createdAt: r.createdAt.toISOString(),
    }));
    // The inbox is capped at 30, so counting from the page is exact.
    const unreadCount = items.filter((i) => !i.read).length;

    c.header('Cache-Control', 'private, max-age=5');
    return c.json({ data: { items, unreadCount } });
  },
);

// ─── POST /v1/notifications/read-all ────────────────────────────────
notificationsRoute.post(
  '/read-all',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const user = c.var.user;
    if (!user) {
      return c.json({ error: { code: 'unauthenticated', message: 'Sign in required.' } }, 401);
    }
    await c.var.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return c.json({ data: { ok: true } });
  },
);

// ─── POST /v1/notifications/:id/read ────────────────────────────────
notificationsRoute.post(
  '/:id/read',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const user = c.var.user;
    if (!user) {
      return c.json({ error: { code: 'unauthenticated', message: 'Sign in required.' } }, 401);
    }
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) {
      return c.json({ error: { code: 'invalid_id', message: 'Malformed id.' } }, 400);
    }
    // The compound WHERE is the security boundary — another user's id no-ops.
    await c.var.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));
    return c.json({ data: { ok: true } });
  },
);

// ─── DELETE /v1/notifications (clear all) ───────────────────────────
notificationsRoute.delete(
  '/',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const user = c.var.user;
    if (!user) {
      return c.json({ error: { code: 'unauthenticated', message: 'Sign in required.' } }, 401);
    }
    await c.var.db.delete(notifications).where(eq(notifications.userId, user.id));
    return c.body(null, 204);
  },
);
