/**
 * `/v1/admin/monitoring` — superadmin-only oversight of template
 * publishing and staff activity.
 *
 * Gated by `withAdmin({ role: 'superadmin' })`. Almost everything here
 * exposes data that already exists (`template_versions.published_by`,
 * `admin_audit_log`) — the value is the aggregation + attribution, not
 * new writes. The single mutation (`set-owner`) is a defensive tool for
 * the deleted-admin edge case and is itself audited.
 *
 * Routes:
 *   GET  /published-templates           — published templates + publisher
 *   POST /published-templates/:id/set-owner — re-attribute latest version
 *   GET  /admin-metrics                 — per-admin publish leaderboard
 *   GET  /activity                      — human-readable audit feed
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { adminAuditLog, templateVersions, templates, users } from '@clickfy/db';
import type {
  MonitoringActivityEntry,
  MonitoringAdminMetric,
  MonitoringPublishedTemplate,
  MonitoringSummary,
} from '@clickfy/types';

import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const adminMonitoringRoute = new Hono<AppEnv>();

adminMonitoringRoute.use(
  '*',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ role: 'superadmin' }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
);

// ─── Published templates with publisher attribution ─────────────────

const publishedQuerySchema = z.object({
  q: z.string().trim().optional(),
  sort: z.enum(['newest', 'oldest', 'title_asc']).optional().default('newest'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

adminMonitoringRoute.get('/published-templates', async (c) => {
  const parsed = publishedQuerySchema.safeParse({
    q: c.req.query('q'),
    sort: c.req.query('sort'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid_query', message: 'Bad query params.' } }, 400);
  }
  const { q, sort, limit, offset } = parsed.data;

  const conditions: SQL[] = [eq(templates.status, 'published')];
  if (q) conditions.push(ilike(templates.title, `%${q}%`));
  const whereExpr = and(...conditions);

  const orderBy =
    sort === 'oldest'
      ? sql`${templates.publishedAt} asc nulls last`
      : sort === 'title_asc'
        ? sql`lower(${templates.title}) asc`
        : sql`${templates.publishedAt} desc nulls last`;

  const [rows, [{ total }]] = await Promise.all([
    c.var.db
      .select({
        id: templates.id,
        title: templates.title,
        kind: templates.kind,
        publishedAt: templates.publishedAt,
      })
      .from(templates)
      .where(whereExpr)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    c.var.db
      .select({ total: sql<number>`count(*)::int` })
      .from(templates)
      .where(whereExpr),
  ]);

  const ids = rows.map((r) => r.id);

  // Resolve each template's latest version (publisher + version count).
  // The page is small (<=100 templates), so loading their versions and
  // reducing in JS is simpler and cheaper than a correlated subquery.
  const versionRows = ids.length
    ? await c.var.db
        .select({
          templateId: templateVersions.templateId,
          versionNumber: templateVersions.versionNumber,
          publishedBy: templateVersions.publishedBy,
          publisherName: users.name,
          publisherEmail: users.email,
        })
        .from(templateVersions)
        .leftJoin(users, eq(templateVersions.publishedBy, users.id))
        .where(inArray(templateVersions.templateId, ids))
    : [];

  const latestByTemplate = new Map<
    string,
    { versionCount: number; maxVersion: number; publishedBy: string | null; name: string | null; email: string | null }
  >();
  for (const v of versionRows) {
    const cur = latestByTemplate.get(v.templateId);
    if (!cur) {
      latestByTemplate.set(v.templateId, {
        versionCount: 1,
        maxVersion: v.versionNumber,
        publishedBy: v.publishedBy,
        name: v.publisherName,
        email: v.publisherEmail,
      });
      continue;
    }
    cur.versionCount += 1;
    if (v.versionNumber > cur.maxVersion) {
      cur.maxVersion = v.versionNumber;
      cur.publishedBy = v.publishedBy;
      cur.name = v.publisherName;
      cur.email = v.publisherEmail;
    }
  }

  const data: MonitoringPublishedTemplate[] = rows.map((r) => {
    const latest = latestByTemplate.get(r.id);
    return {
      id: r.id,
      title: r.title,
      kind: r.kind,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      versionCount: latest?.versionCount ?? 0,
      publisherId: latest?.publishedBy ?? null,
      publisherName: latest?.name ?? null,
      publisherEmail: latest?.email ?? null,
    };
  });

  return c.json({
    data,
    meta: { total, limit, offset, hasMore: offset + rows.length < total },
  });
});

// ─── Re-attribute a template's latest version (deleted-admin fix) ───

adminMonitoringRoute.post(
  '/published-templates/:id/set-owner',
  zValidator('param', z.object({ id: z.string().uuid() })),
  zValidator('json', z.object({ ownerId: z.string().uuid() })),
  async (c) => {
    const { id } = c.req.valid('param');
    const { ownerId } = c.req.valid('json');

    // The new owner must be an existing staff member.
    const owner = await c.var.db.query.users.findFirst({ where: eq(users.id, ownerId) });
    if (!owner || !owner.adminRole) {
      return c.json(
        { error: { code: 'invalid_owner', message: 'Owner must be a staff member.' } },
        400,
      );
    }

    // Find the template's latest version row.
    const [latest] = await c.var.db
      .select({ vid: templateVersions.id, version: templateVersions.versionNumber })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, id))
      .orderBy(desc(templateVersions.versionNumber))
      .limit(1);

    if (!latest) {
      return c.json(
        { error: { code: 'not_found', message: 'Template has no published version.' } },
        404,
      );
    }

    await c.var.db
      .update(templateVersions)
      .set({ publishedBy: ownerId })
      .where(eq(templateVersions.id, latest.vid));

    c.set('audit', {
      resourceId: id,
      metadata: { action: 'set_owner', ownerId, ownerEmail: owner.email, version: latest.version },
    });

    return c.json({ data: { ok: true } });
  },
);

// ─── Per-admin publish metrics (leaderboard) ────────────────────────

const metricsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

adminMonitoringRoute.get('/admin-metrics', async (c) => {
  const parsed = metricsQuerySchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
  });
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid_query', message: 'Bad query params.' } }, 400);
  }
  const { from, to } = parsed.data;
  const hasCustom = Boolean(from || to);

  const customFilter: SQL<number> = hasCustom
    ? sql<number>`count(*) filter (where ${templateVersions.publishedAt} >= ${from ?? '-infinity'}::timestamptz and ${templateVersions.publishedAt} <= ${to ?? 'infinity'}::timestamptz)::int`
    : sql<number>`0::int`;

  const [rows, [{ publishedTemplates }]] = await Promise.all([
    c.var.db
      .select({
        adminId: templateVersions.publishedBy,
        name: users.name,
        email: users.email,
        role: users.adminRole,
        total: sql<number>`count(*)::int`,
        last7d: sql<number>`count(*) filter (where ${templateVersions.publishedAt} >= now() - interval '7 days')::int`,
        prev7d: sql<number>`count(*) filter (where ${templateVersions.publishedAt} >= now() - interval '14 days' and ${templateVersions.publishedAt} < now() - interval '7 days')::int`,
        last30d: sql<number>`count(*) filter (where ${templateVersions.publishedAt} >= now() - interval '30 days')::int`,
        prev30d: sql<number>`count(*) filter (where ${templateVersions.publishedAt} >= now() - interval '60 days' and ${templateVersions.publishedAt} < now() - interval '30 days')::int`,
        custom: customFilter,
      })
      .from(templateVersions)
      .leftJoin(users, eq(templateVersions.publishedBy, users.id))
      .groupBy(templateVersions.publishedBy, users.name, users.email, users.adminRole)
      .orderBy(desc(sql`count(*)`)),
    c.var.db
      .select({ publishedTemplates: sql<number>`count(*)::int` })
      .from(templates)
      .where(eq(templates.status, 'published')),
  ]);

  const data: MonitoringAdminMetric[] = rows.map((r) => ({
    adminId: r.adminId,
    name: r.name,
    email: r.email,
    role: r.role,
    total: r.total,
    last7d: r.last7d,
    prev7d: r.prev7d,
    last30d: r.last30d,
    prev30d: r.prev30d,
    ...(hasCustom ? { custom: r.custom } : {}),
  }));

  const summary: MonitoringSummary = {
    publishedTemplates,
    totalPublishes: rows.reduce((acc, r) => acc + r.total, 0),
    thisWeek: rows.reduce((acc, r) => acc + r.last7d, 0),
    lastWeek: rows.reduce((acc, r) => acc + r.prev7d, 0),
    thisMonth: rows.reduce((acc, r) => acc + r.last30d, 0),
    lastMonth: rows.reduce((acc, r) => acc + r.prev30d, 0),
    activePublishers: rows.filter((r) => r.adminId !== null && r.total > 0).length,
  };

  return c.json({ data, summary, window: { from: from ?? null, to: to ?? null } });
});

// ─── Activity feed (human-readable audit log) ───────────────────────

const activityQuerySchema = z.object({
  actor: z.string().uuid().optional(),
  method: z.enum(['POST', 'PATCH', 'PUT', 'DELETE']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * Turn a raw audit row into a human-readable sentence. Prefers the
 * handler-supplied `metadata.action` (publish/create/reorder/set_role…)
 * and falls back to a method+path summary for routes that don't enrich.
 */
function describeActivity(
  method: string,
  path: string,
  metadata: Record<string, unknown> | null,
): string {
  const action = metadata?.action as string | undefined;
  switch (action) {
    case 'publish':
      return `Published “${metadata?.templateTitle ?? 'a template'}” (v${metadata?.versionNumber ?? '?'})`;
    case 'create':
      return `Created template “${metadata?.title ?? 'untitled'}”`;
    case 'reorder':
      return `Reordered ${metadata?.count ?? 'several'} templates`;
    case 'set_role':
      return `Changed a member's role to ${metadata?.role ?? '?'}`;
    case 'set_pages':
      return `Updated a member's page permissions`;
    case 'promote':
      return `Promoted ${metadata?.email ?? 'a user'} to ${metadata?.role ?? 'staff'}`;
    case 'demote':
      return `Removed staff access from ${metadata?.email ?? 'a user'}`;
    case 'set_owner':
      return `Re-attributed a template to ${metadata?.ownerEmail ?? 'a staff member'}`;
    default: {
      const verb =
        method === 'POST'
          ? 'Created'
          : method === 'DELETE'
            ? 'Deleted'
            : 'Updated';
      // Strip the `/v1/admin` prefix for readability.
      const section = path.replace(/^\/v1\/admin\//, '').split('/')[0] || 'resource';
      return `${verb} ${section}`;
    }
  }
}

adminMonitoringRoute.get('/activity', async (c) => {
  const parsed = activityQuerySchema.safeParse({
    actor: c.req.query('actor'),
    method: c.req.query('method'),
    from: c.req.query('from'),
    to: c.req.query('to'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid_query', message: 'Bad query params.' } }, 400);
  }
  const { actor, method, from, to, limit, offset } = parsed.data;

  const conditions: SQL[] = [];
  if (actor) conditions.push(eq(adminAuditLog.adminUserId, actor));
  if (method) conditions.push(eq(adminAuditLog.method, method));
  if (from) conditions.push(gte(adminAuditLog.createdAt, new Date(from)));
  if (to) conditions.push(lte(adminAuditLog.createdAt, new Date(to)));
  const whereExpr = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    c.var.db
      .select({
        id: adminAuditLog.id,
        adminId: adminAuditLog.adminUserId,
        adminName: users.name,
        adminEmail: users.email,
        method: adminAuditLog.method,
        path: adminAuditLog.path,
        resourceId: adminAuditLog.resourceId,
        metadata: adminAuditLog.metadata,
        createdAt: adminAuditLog.createdAt,
      })
      .from(adminAuditLog)
      .leftJoin(users, eq(adminAuditLog.adminUserId, users.id))
      .where(whereExpr)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(limit)
      .offset(offset),
    c.var.db
      .select({ total: sql<number>`count(*)::int` })
      .from(adminAuditLog)
      .where(whereExpr),
  ]);

  const data: MonitoringActivityEntry[] = rows.map((r) => ({
    id: r.id,
    adminId: r.adminId,
    adminName: r.adminName,
    adminEmail: r.adminEmail,
    method: r.method,
    path: r.path,
    resourceId: r.resourceId,
    description: describeActivity(r.method, r.path, r.metadata),
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
  }));

  return c.json({
    data,
    meta: { total, limit, offset, hasMore: offset + rows.length < total },
  });
});
