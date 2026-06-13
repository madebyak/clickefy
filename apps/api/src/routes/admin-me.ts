/**
 * `/v1/admin/me` — the signed-in staff member's permission context.
 *
 * The admin dashboard loads this once on boot to gate navigation, render
 * the footer (real name + role badge), and drive the deep-link route
 * guard. Authorization itself is always re-checked server-side per
 * request — this endpoint is a convenience mirror, never the gate.
 *
 * Auth: `withAuth + withCurrentUser + withAdmin`. `withAdmin()` has
 * already resolved `c.var.adminContext` (role + effective pages) by the
 * time the handler runs, so this is a zero-query read.
 */

import { Hono } from 'hono';

import type { AdminMe } from '@clickfy/types';

import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import type { AppEnv } from '../types';

export const adminMeRoute = new Hono<AppEnv>();

adminMeRoute.use('*', withAuth({ required: true }), withCurrentUser(), withAdmin());

adminMeRoute.get('/', (c) => {
  const user = c.var.user!;
  const ctx = c.var.adminContext!;

  const body: AdminMe = {
    userId: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: ctx.role,
    pages: ctx.effectivePages,
  };

  return c.json({ data: body });
});
