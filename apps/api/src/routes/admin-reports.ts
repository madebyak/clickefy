/**
 * `/v1/admin/reports` — moderation queue.
 *
 * Mounted under `withAdmin()` so every mutation is automatically
 * recorded in `admin_audit_log` (see middleware/with-auth.ts).
 *
 * Routes:
 *   GET    /                — paginated queue (default: status=open)
 *   GET    /:id             — single report with reporter context
 *   PATCH  /:id             — claim, resolve, or dismiss
 *
 * Cursor pagination uses (created_at, id) DESC, the same shape as
 * the jobs queue, so the index defined in 0007_reports.sql gets used.
 */

import { Hono } from 'hono';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { reports, users } from '@clickfy/db';

import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import type { AppEnv } from '../types';

export const adminReportsRoute = new Hono<AppEnv>();

adminReportsRoute.use('*', withAuth({ required: true }), withCurrentUser(), withAdmin());

const ListQuerySchema = z.object({
  status: z
    .enum(['open', 'reviewing', 'resolved', 'dismissed', 'all'])
    .optional()
    .default('open'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

adminReportsRoute.get('/', async (c) => {
  const parsed = ListQuerySchema.safeParse({
    status: c.req.query('status'),
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid_query', message: 'Bad query params.' } }, 400);
  }
  const { status, cursor, limit } = parsed.data;

  // Decode cursor: `${createdAt ISO}_${id}`. We use composite-keyset
  // pagination so ties on created_at don't drop rows when admins
  // process the queue and timestamps cluster within milliseconds.
  let cursorClause = sql`true`;
  if (cursor) {
    const [createdAtRaw, idRaw] = cursor.split('_');
    if (createdAtRaw && idRaw) {
      const createdAt = new Date(createdAtRaw);
      cursorClause = or(
        lt(reports.createdAt, createdAt),
        and(eq(reports.createdAt, createdAt), lt(reports.id, idRaw)),
      )!;
    }
  }

  const statusClause = status === 'all' ? sql`true` : eq(reports.status, status);

  const rows = await c.var.db
    .select({
      id: reports.id,
      targetType: reports.targetType,
      targetId: reports.targetId,
      reason: reports.reason,
      notes: reports.notes,
      status: reports.status,
      adminNotes: reports.adminNotes,
      createdAt: reports.createdAt,
      resolvedAt: reports.resolvedAt,
      reporterUserId: reports.reporterUserId,
      reporterEmail: users.email,
    })
    .from(reports)
    .leftJoin(users, eq(reports.reporterUserId, users.id))
    .where(and(statusClause, cursorClause))
    .orderBy(desc(reports.createdAt), desc(reports.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? `${last.createdAt.toISOString()}_${last.id}` : null;

  return c.json({ data: page, nextCursor });
});

adminReportsRoute.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.var.db.query.reports.findFirst({
    where: eq(reports.id, id),
  });
  if (!row) {
    return c.json({ error: { code: 'not_found', message: 'Report not found.' } }, 404);
  }

  // Fetch reporter context separately — left-join above is fine for
  // the list view but here we want the full row.
  const reporter = row.reporterUserId
    ? await c.var.db.query.users.findFirst({ where: eq(users.id, row.reporterUserId) })
    : null;

  return c.json({
    data: {
      ...row,
      reporter: reporter
        ? {
            id: reporter.id,
            email: reporter.email,
            name: reporter.name,
            entitlement: reporter.entitlement,
            isDeleted: reporter.isDeleted,
          }
        : null,
    },
  });
});

const PatchSchema = z.object({
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).optional(),
  adminNotes: z.string().max(4000).optional(),
});

adminReportsRoute.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const parsed = PatchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid_input', message: 'Bad payload.' } }, 400);
  }
  const input = parsed.data;
  if (!input.status && input.adminNotes === undefined) {
    return c.json(
      { error: { code: 'no_changes', message: 'Provide status or adminNotes.' } },
      400,
    );
  }

  const admin = c.var.user!;
  // Stamp `resolved_at` + `resolved_by_user_id` only when the new
  // status is terminal — moving back from resolved to reviewing
  // should NOT carry the prior resolver's name forever.
  const isTerminal = input.status === 'resolved' || input.status === 'dismissed';

  const [updated] = await c.var.db
    .update(reports)
    .set({
      ...(input.status && { status: input.status }),
      ...(input.adminNotes !== undefined && { adminNotes: input.adminNotes }),
      ...(input.status && {
        resolvedAt: isTerminal ? new Date() : null,
        resolvedByUserId: isTerminal ? admin.id : null,
      }),
    })
    .where(eq(reports.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: { code: 'not_found', message: 'Report not found.' } }, 404);
  }

  return c.json({ data: updated });
});
