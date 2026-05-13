/**
 * /v1/admin/users — admin-only user management endpoints.
 *
 * Strategy: list + paginate from Neon (fast, indexed, joinable for the
 * lifetime aggregates the dashboard cares about); fetch the live Clerk
 * record only on the detail drawer so we don't burn Clerk API rate
 * limits enumerating the table.
 *
 * Mutations are append-only on the ledger side. Manual credit
 * adjustments insert a `reason='admin_adjust'` row and update the
 * cached `users.credits_balance`. We deliberately do NOT wrap these in
 * a single SQL transaction (Neon HTTP driver doesn't support multi-
 * statement tx); the order is "ledger first, then balance update" so a
 * mid-flight failure leaves the ledger as the source of truth and the
 * cached balance can be reconciled by `SUM(delta)`.
 *
 * Hard delete cascades through Neon FKs (jobs, ledger) — see schema
 * for the `onDelete` declarations. Clerk deletion is best-effort: if
 * the user no longer exists in Clerk we still drop the Neon row so the
 * dashboard isn't stuck with a ghost.
 */

import { createClerkClient } from '@clerk/backend';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';

import {
  creditLedger,
  jobs,
  templates,
  users,
} from '@clickfy/db';
import {
  withPreferenceDefaults,
  type AdminCreditLedgerEntry,
  type AdminUserClerkSnapshot,
  type AdminUserDetail,
  type AdminUserJobSummary,
  type AdminUserListItem,
  type CreditReason,
} from '@clickfy/types';

import type { AppEnv } from '../types';
import {
  withAdmin,
  withAuth,
  withCurrentUser,
} from '../middleware/with-auth';

export const adminUsersRoute = new Hono<AppEnv>();

// ─── Helpers ────────────────────────────────────────────────────────

function toListItem(
  row: typeof users.$inferSelect,
  jobsCount: number,
  creditsSpent: number,
): AdminUserListItem {
  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    locale: row.locale,
    entitlement: row.entitlement,
    creditsBalance: row.creditsBalance,
    subscriptionRenewsAt: row.subscriptionRenewsAt?.toISOString() ?? null,
    subscriptionExpiresAt: row.subscriptionExpiresAt?.toISOString() ?? null,
    isDeleted: row.isDeleted,
    purgeAssetsAt: row.purgeAssetsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    jobsCount,
    creditsSpent,
  };
}

function epochMsToIso(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

// ─── List ───────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  creditsMin: z.coerce.number().int().optional(),
  creditsMax: z.coerce.number().int().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

adminUsersRoute.get(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('query', listQuerySchema),
  async (c) => {
    const q = c.req.valid('query');

    const whereParts: SQL[] = [];
    if (q.search) {
      const needle = `%${q.search}%`;
      const orExpr = or(
        ilike(users.email, needle),
        ilike(users.name, needle),
        ilike(users.clerkUserId, needle),
      );
      if (orExpr) whereParts.push(orExpr);
    }
    if (typeof q.creditsMin === 'number') {
      whereParts.push(gte(users.creditsBalance, q.creditsMin));
    }
    if (typeof q.creditsMax === 'number') {
      whereParts.push(lte(users.creditsBalance, q.creditsMax));
    }

    // Cursor format: `<createdAtIsoMs>:<id>`. Ordering is newest-first.
    if (q.cursor) {
      const [createdMsRaw, idCursor] = q.cursor.split(':');
      const createdMs = Number.parseInt(createdMsRaw, 10);
      if (Number.isFinite(createdMs) && idCursor) {
        whereParts.push(
          sql`(${users.createdAt}, ${users.id}::text) < (to_timestamp(${createdMs / 1000}), ${idCursor})`,
        );
      }
    }

    const whereClause =
      whereParts.length > 0 ? and(...whereParts) : undefined;

    // One round-trip for the page, plus a cheap COUNT(*) so the UI can
    // render "1,234 users" in the header. Aggregates per row (jobs
    // count + credits spent) come from correlated subqueries so we
    // don't pay an N+1.
    const jobsCountSql = sql<number>`(
      SELECT COUNT(*)::int FROM ${jobs} WHERE ${jobs.userId} = ${users.id}
    )`;
    const creditsSpentSql = sql<number>`(
      SELECT COALESCE(-SUM(${creditLedger.delta}), 0)::int
      FROM ${creditLedger}
      WHERE ${creditLedger.userId} = ${users.id} AND ${creditLedger.delta} < 0
    )`;

    const rows = await c.var.db
      .select({
        row: users,
        jobsCount: jobsCountSql,
        creditsSpent: creditsSpentSql,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? `${last.row.createdAt.getTime()}:${last.row.id}`
        : null;

    const data: AdminUserListItem[] = page.map((r) =>
      toListItem(r.row, r.jobsCount ?? 0, r.creditsSpent ?? 0),
    );

    // Total only when there's no cursor (first page). Cheap enough for
    // <100k users; revisit if we grow past that.
    let total: number | null = null;
    if (!q.cursor) {
      const [{ count }] = await c.var.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(users)
        .where(whereClause);
      total = count ?? 0;
    }

    return c.json({ data, nextCursor, total });
  },
);

// ─── Detail (Neon + live Clerk) ─────────────────────────────────────

const idParamSchema = z.object({ id: z.string().uuid() });

adminUsersRoute.get(
  '/:id',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');

    const row = await c.var.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!row) {
      return c.json(
        { error: { code: 'not_found', message: 'User not found.' } },
        404,
      );
    }

    // Aggregates + recent activity, in parallel.
    const [
      [{ jobsCount }],
      [{ creditsSpent }],
      jobRows,
      ledgerRows,
    ] = await Promise.all([
      c.var.db
        .select({ jobsCount: sql<number>`COUNT(*)::int` })
        .from(jobs)
        .where(eq(jobs.userId, id)),
      c.var.db
        .select({
          creditsSpent: sql<number>`COALESCE(-SUM(${creditLedger.delta}), 0)::int`,
        })
        .from(creditLedger)
        .where(
          and(eq(creditLedger.userId, id), sql`${creditLedger.delta} < 0`),
        ),
      c.var.db
        .select({
          id: jobs.id,
          templateId: jobs.templateId,
          templateTitle: templates.title,
          status: jobs.status,
          createdAt: jobs.createdAt,
          completedAt: jobs.completedAt,
        })
        .from(jobs)
        .leftJoin(templates, eq(templates.id, jobs.templateId))
        .where(eq(jobs.userId, id))
        .orderBy(desc(jobs.createdAt))
        .limit(20),
      c.var.db
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.userId, id))
        .orderBy(desc(creditLedger.createdAt))
        .limit(50),
    ]);

    const recentJobs: AdminUserJobSummary[] = jobRows.map((j) => ({
      id: j.id,
      templateId: j.templateId,
      templateTitle: j.templateTitle,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
      completedAt: j.completedAt?.toISOString() ?? null,
    }));

    const recentLedger: AdminCreditLedgerEntry[] = ledgerRows.map((l) => ({
      id: l.id,
      delta: l.delta,
      reason: l.reason as CreditReason,
      balanceAfter: l.balanceAfter,
      jobId: l.jobId,
      revenueCatTransactionId: l.revenueCatTransactionId,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
    }));

    // Live Clerk lookup. We swallow errors so the drawer still renders
    // the Neon-side data when Clerk is unreachable / the user has been
    // deleted upstream.
    let clerk: AdminUserClerkSnapshot | null = null;
    if (c.env.CLERK_SECRET_KEY) {
      try {
        const client = createClerkClient({ secretKey: c.env.CLERK_SECRET_KEY });
        const u = await client.users.getUser(row.clerkUserId);
        const primaryEmailRecord = u.emailAddresses.find(
          (e) => e.id === u.primaryEmailAddressId,
        );
        const primaryPhoneRecord = u.phoneNumbers.find(
          (p) => p.id === u.primaryPhoneNumberId,
        );
        clerk = {
          id: u.id,
          primaryEmail: primaryEmailRecord?.emailAddress ?? null,
          primaryEmailVerified:
            primaryEmailRecord?.verification?.status === 'verified',
          primaryPhone: primaryPhoneRecord?.phoneNumber ?? null,
          imageUrl: u.imageUrl ?? null,
          username: u.username ?? null,
          banned: u.banned ?? false,
          locked: u.locked ?? false,
          twoFactorEnabled: u.twoFactorEnabled ?? false,
          passwordEnabled: u.passwordEnabled ?? false,
          totpEnabled: u.totpEnabled ?? false,
          externalAccounts: u.externalAccounts.map((ea) => ({
            provider: ea.provider,
            emailAddress: ea.emailAddress ?? null,
          })),
          lastSignInAt: epochMsToIso(u.lastSignInAt),
          lastActiveAt: epochMsToIso(u.lastActiveAt),
          createdAt: epochMsToIso(u.createdAt) ?? new Date(0).toISOString(),
          updatedAt: epochMsToIso(u.updatedAt) ?? new Date(0).toISOString(),
        };
      } catch (err) {
        console.warn(
          '[admin-users.detail] Clerk lookup failed (continuing):',
          err,
        );
      }
    }

    const detail: AdminUserDetail = {
      ...toListItem(row, jobsCount ?? 0, creditsSpent ?? 0),
      preferences: withPreferenceDefaults(row.preferences),
      clerk,
      recentJobs,
      recentLedger,
    };

    return c.json({ data: detail });
  },
);

// ─── Adjust credits ─────────────────────────────────────────────────

const adjustCreditsSchema = z
  .object({
    delta: z
      .number()
      .int()
      .refine((n) => n !== 0, 'Delta must be non-zero.'),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

adminUsersRoute.post(
  '/:id/credits',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('param', idParamSchema),
  zValidator('json', adjustCreditsSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { delta, note } = c.req.valid('json');

    const row = await c.var.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!row) {
      return c.json(
        { error: { code: 'not_found', message: 'User not found.' } },
        404,
      );
    }

    const newBalance = row.creditsBalance + delta;
    if (newBalance < 0) {
      return c.json(
        {
          error: {
            code: 'negative_balance',
            message: `Adjustment would push balance below zero (${row.creditsBalance} ${
              delta >= 0 ? '+' : ''
            }${delta} = ${newBalance}).`,
          },
        },
        400,
      );
    }

    // Ledger row first, then cached balance — see file-header note.
    await c.var.db.insert(creditLedger).values({
      userId: id,
      delta,
      reason: 'admin_adjust',
      balanceAfter: newBalance,
      note: note?.length ? note : null,
    });

    const [updated] = await c.var.db
      .update(users)
      .set({ creditsBalance: newBalance })
      .where(eq(users.id, id))
      .returning();

    if (!updated) {
      return c.json(
        {
          error: {
            code: 'update_failed',
            message: 'Ledger row inserted but user balance update failed.',
          },
        },
        500,
      );
    }

    return c.json({
      data: {
        creditsBalance: updated.creditsBalance,
        delta,
      },
    });
  },
);

// ─── Set entitlement ────────────────────────────────────────────────

const setEntitlementSchema = z
  .object({
    entitlement: z.enum(['free', 'pro', 'pro_max', 'admin']),
  })
  .strict();

adminUsersRoute.patch(
  '/:id/entitlement',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('param', idParamSchema),
  zValidator('json', setEntitlementSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { entitlement } = c.req.valid('json');

    const [updated] = await c.var.db
      .update(users)
      .set({ entitlement })
      .where(eq(users.id, id))
      .returning();

    if (!updated) {
      return c.json(
        { error: { code: 'not_found', message: 'User not found.' } },
        404,
      );
    }
    return c.json({ data: { entitlement: updated.entitlement } });
  },
);

// ─── Ban / unban via Clerk ──────────────────────────────────────────

adminUsersRoute.post(
  '/:id/ban',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('param', idParamSchema),
  async (c) => {
    if (!c.env.CLERK_SECRET_KEY) {
      return c.json(
        {
          error: {
            code: 'clerk_unconfigured',
            message: 'CLERK_SECRET_KEY is not set on the Worker.',
          },
        },
        500,
      );
    }

    const { id } = c.req.valid('param');
    const row = await c.var.db.query.users.findFirst({ where: eq(users.id, id) });
    if (!row) {
      return c.json(
        { error: { code: 'not_found', message: 'User not found.' } },
        404,
      );
    }

    const client = createClerkClient({ secretKey: c.env.CLERK_SECRET_KEY });
    await client.users.banUser(row.clerkUserId);
    return c.json({ data: { banned: true } });
  },
);

adminUsersRoute.post(
  '/:id/unban',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('param', idParamSchema),
  async (c) => {
    if (!c.env.CLERK_SECRET_KEY) {
      return c.json(
        {
          error: {
            code: 'clerk_unconfigured',
            message: 'CLERK_SECRET_KEY is not set on the Worker.',
          },
        },
        500,
      );
    }

    const { id } = c.req.valid('param');
    const row = await c.var.db.query.users.findFirst({ where: eq(users.id, id) });
    if (!row) {
      return c.json(
        { error: { code: 'not_found', message: 'User not found.' } },
        404,
      );
    }

    const client = createClerkClient({ secretKey: c.env.CLERK_SECRET_KEY });
    await client.users.unbanUser(row.clerkUserId);
    return c.json({ data: { banned: false } });
  },
);

// ─── Soft delete ────────────────────────────────────────────────────

adminUsersRoute.post(
  '/:id/soft-delete',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    // Match the convention from the schema doc-comment: 60 days before
    // we sweep R2/Stream assets. The asset purge cron walks rows whose
    // `purge_assets_at <= now()`.
    const purgeAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const [updated] = await c.var.db
      .update(users)
      .set({ isDeleted: true, purgeAssetsAt: purgeAt })
      .where(eq(users.id, id))
      .returning();
    if (!updated) {
      return c.json(
        { error: { code: 'not_found', message: 'User not found.' } },
        404,
      );
    }
    return c.json({
      data: {
        isDeleted: true,
        purgeAssetsAt: updated.purgeAssetsAt?.toISOString() ?? null,
      },
    });
  },
);

// ─── Hard delete (Clerk + Neon) ─────────────────────────────────────

adminUsersRoute.delete(
  '/:id',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await c.var.db.query.users.findFirst({ where: eq(users.id, id) });
    if (!row) {
      return c.json(
        { error: { code: 'not_found', message: 'User not found.' } },
        404,
      );
    }

    if (c.env.CLERK_SECRET_KEY) {
      try {
        const client = createClerkClient({ secretKey: c.env.CLERK_SECRET_KEY });
        await client.users.deleteUser(row.clerkUserId);
      } catch (err) {
        // 404 from Clerk → user already gone, proceed. Anything else →
        // surface so the admin can retry rather than half-deleting.
        const message = err instanceof Error ? err.message : String(err);
        const isNotFound =
          message.toLowerCase().includes('not found') ||
          message.includes('404');
        if (!isNotFound) {
          return c.json(
            {
              error: {
                code: 'clerk_delete_failed',
                message,
              },
            },
            502,
          );
        }
        console.warn(
          '[admin-users.delete] Clerk user already absent, continuing:',
          message,
        );
      }
    } else {
      console.warn(
        '[admin-users.delete] CLERK_SECRET_KEY missing — skipping Clerk deletion.',
      );
    }

    // Cascades to credit_ledger (onDelete: cascade) and jobs (onDelete:
    // cascade). Templates are restrict-protected by jobs FKs, but the
    // cascade chain handles them via `jobs` removal.
    await c.var.db.delete(users).where(eq(users.id, id));

    return c.json({ data: { id, deleted: true } });
  },
);
