/**
 * `/v1/admin/team` — staff & role management (superadmin only).
 *
 * Gated by `withAdmin({ role: 'superadmin' })`, so every endpoint here is
 * unreachable for `admin` / `creator` (and, transitively, normal users).
 * Mutations are recorded in `admin_audit_log` by the same middleware.
 *
 * Routes:
 *   GET    /              — list staff (admin_role IS NOT NULL)
 *   PATCH  /:id/role      — change a member's role
 *   PATCH  /:id/pages     — set a member's page grant/revoke overrides
 *   POST   /:id/promote   — turn a normal user into staff
 *   POST   /:id/demote    — remove staff access entirely
 *
 * Safeguards (defense against self-inflicted lockout — none existed
 * before this feature):
 *   - The last remaining superadmin cannot be demoted, role-changed away
 *     from superadmin, or stripped of staff access — by anyone, including
 *     themselves. This guarantees the org can never lose its only owner.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { users } from '@clickfy/db';
import {
  ADMIN_ROLES,
  SUPERADMIN_ONLY_PAGES,
  computeEffectivePages,
  normalizePageOverrides,
  type AdminPageKey,
  type AdminRole,
  type AdminTeamMember,
} from '@clickfy/types';

import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const adminTeamRoute = new Hono<AppEnv>();

adminTeamRoute.use(
  '*',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ role: 'superadmin' }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
);

const roleSchema = z.enum(ADMIN_ROLES as unknown as [AdminRole, ...AdminRole[]]);
const idParamSchema = z.object({ id: z.string().uuid() });
const pageArraySchema = z.array(z.string()).default([]);

type StaffRow = typeof users.$inferSelect;

function toMember(row: StaffRow): AdminTeamMember {
  const role = row.adminRole!;
  const overrides = normalizePageOverrides(row.adminPageOverrides);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    role,
    overrides,
    pages: computeEffectivePages(role, overrides),
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/** Count current superadmins, optionally excluding one id. */
async function countSuperadmins(db: AppEnv['Variables']['db'], excludeId?: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(
      excludeId
        ? and(eq(users.adminRole, 'superadmin'), ne(users.id, excludeId))
        : eq(users.adminRole, 'superadmin'),
    );
  return n;
}

// ─── List staff ─────────────────────────────────────────────────────

adminTeamRoute.get('/', async (c) => {
  const rows = await c.var.db
    .select()
    .from(users)
    .where(and(isNotNull(users.adminRole), eq(users.isDeleted, false)))
    .orderBy(asc(users.createdAt));

  return c.json({ data: rows.map(toMember) });
});

// ─── Change role ────────────────────────────────────────────────────

adminTeamRoute.patch(
  '/:id/role',
  zValidator('param', idParamSchema),
  zValidator('json', z.object({ role: roleSchema })),
  async (c) => {
    const { id } = c.req.valid('param');
    const { role } = c.req.valid('json');

    const target = await c.var.db.query.users.findFirst({ where: eq(users.id, id) });
    if (!target || !target.adminRole) {
      return c.json({ error: { code: 'not_found', message: 'Staff member not found.' } }, 404);
    }

    // Last-superadmin guard: never let the only owner drop below superadmin.
    if (target.adminRole === 'superadmin' && role !== 'superadmin') {
      const others = await countSuperadmins(c.var.db, id);
      if (others === 0) {
        return c.json(
          {
            error: {
              code: 'last_superadmin',
              message: 'Cannot change the role of the last superadmin.',
            },
          },
          409,
        );
      }
    }

    const [updated] = await c.var.db
      .update(users)
      .set({ adminRole: role })
      .where(eq(users.id, id))
      .returning();

    c.set('audit', {
      resourceId: id,
      metadata: { action: 'set_role', role, previousRole: target.adminRole },
    });

    return c.json({ data: toMember(updated!) });
  },
);

// ─── Set page overrides ─────────────────────────────────────────────

adminTeamRoute.patch(
  '/:id/pages',
  zValidator('param', idParamSchema),
  zValidator('json', z.object({ grant: pageArraySchema, revoke: pageArraySchema })),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const target = await c.var.db.query.users.findFirst({ where: eq(users.id, id) });
    if (!target || !target.adminRole) {
      return c.json({ error: { code: 'not_found', message: 'Staff member not found.' } }, 404);
    }

    // Normalise to known keys and strip superadmin-only pages from grant —
    // they can never be handed to a lower role no matter what the client
    // sends. (computeEffectivePages also enforces this at read time.)
    const normalized = normalizePageOverrides(body);
    const grant = normalized.grant.filter(
      (p: AdminPageKey) => !SUPERADMIN_ONLY_PAGES.includes(p),
    );
    const overrides = { grant, revoke: normalized.revoke };

    const [updated] = await c.var.db
      .update(users)
      .set({ adminPageOverrides: overrides })
      .where(eq(users.id, id))
      .returning();

    c.set('audit', {
      resourceId: id,
      metadata: { action: 'set_pages', grant, revoke: overrides.revoke },
    });

    return c.json({ data: toMember(updated!) });
  },
);

// ─── Promote a normal user to staff ─────────────────────────────────

adminTeamRoute.post(
  '/:id/promote',
  zValidator('param', idParamSchema),
  zValidator('json', z.object({ role: roleSchema })),
  async (c) => {
    const { id } = c.req.valid('param');
    const { role } = c.req.valid('json');

    const target = await c.var.db.query.users.findFirst({ where: eq(users.id, id) });
    if (!target) {
      return c.json({ error: { code: 'not_found', message: 'User not found.' } }, 404);
    }
    if (target.isDeleted) {
      return c.json(
        { error: { code: 'invalid_target', message: 'Cannot promote a deleted user.' } },
        400,
      );
    }

    const [updated] = await c.var.db
      .update(users)
      .set({ adminRole: role })
      .where(eq(users.id, id))
      .returning();

    c.set('audit', {
      resourceId: id,
      metadata: { action: 'promote', role, email: target.email },
    });

    return c.json({ data: toMember(updated!) });
  },
);

// ─── Demote (remove staff access) ───────────────────────────────────

adminTeamRoute.post('/:id/demote', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');

  const target = await c.var.db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target || !target.adminRole) {
    return c.json({ error: { code: 'not_found', message: 'Staff member not found.' } }, 404);
  }

  if (target.adminRole === 'superadmin') {
    const others = await countSuperadmins(c.var.db, id);
    if (others === 0) {
      return c.json(
        {
          error: {
            code: 'last_superadmin',
            message: 'Cannot remove the last superadmin.',
          },
        },
        409,
      );
    }
  }

  await c.var.db
    .update(users)
    .set({ adminRole: null, adminPageOverrides: null })
    .where(eq(users.id, id));

  c.set('audit', {
    resourceId: id,
    metadata: { action: 'demote', previousRole: target.adminRole, email: target.email },
  });

  return c.json({ data: { ok: true } });
});
