/**
 * `/v1/admin/stats` — aggregate dashboard data.
 *
 * One endpoint (`GET /overview`) returning everything the admin
 * dashboard needs in a single round trip. All queries run in
 * parallel via `Promise.all`; nothing on this route writes.
 *
 * Time windows are **rolling 24h / 48h** (not "today vs yesterday in
 * a calendar sense"). Rolling windows give a more honest "live ops"
 * pulse and sidestep timezone/midnight ambiguity. The admin UI shows
 * "last 24h" labels accordingly.
 *
 * Stuck-job heuristic mirrors the jobs-worker `recover-stuck-jobs`
 * cron: a job in `processing` for >10min is suspicious, >10min is
 * the alert line shown on the dashboard, the cron actually fails
 * jobs after 600s (10min) — see
 * `apps/jobs-worker/src/trigger/recover-stuck-jobs.ts:152-161`.
 *
 * Auth: `withAuth + withCurrentUser + withAdmin`. We do **not**
 * record reads in `admin_audit_log` — the middleware only logs
 * mutations, and this is a read.
 */

import { Hono } from 'hono';
import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';

import {
  adminAuditLog,
  jobs,
  reports,
  templates,
  users,
} from '@clickfy/db';

import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const adminStatsRoute = new Hono<AppEnv>();

adminStatsRoute.use(
  '*',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
);

// ──────────────────────────────────────────────────────────────────
// Response shape — mirrored verbatim in apps/admin/lib/api/admin-stats.ts.
// Update both sides together if you change a field.
// ──────────────────────────────────────────────────────────────────

type Delta = { value: number; deltaPct: number | null };

export interface AdminStatsOverview {
  generatedAt: string;
  live: {
    jobsProcessing: number;
    jobsQueued: number;
    queuedOldestAgeSec: number | null;
    failedLastHour: number;
    failedLast24h: number;
    stuckJobs: number;
    topErrorCodes: Array<{ code: string; count: number }>;
    openReports: number;
    openReportsOldestAgeHr: number | null;
  };
  today: {
    generations: Delta;
    newSignups: Delta;
    activeUsers: Delta;
    creditsSpent: Delta;
    successRatePct: Delta;
  };
  catalog: {
    templatesTotal: number;
    templatesPublished: number;
    templatesDraft: number;
    topTemplate24h: { id: string; title: string; runs: number } | null;
    categoriesEmpty: number;
  };
  users: {
    total: number;
    paid: number;
    powerUsers30d: number;
    renewingNext7d: number;
  };
  activity: Array<ActivityItem>;
}

type ActivityType =
  | 'signup'
  | 'job_failed'
  | 'report_opened'
  | 'template_published'
  | 'credit_grant'
  | 'admin_action';

interface ActivityItem {
  type: ActivityType;
  at: string;
  href: string;
  title: string;
  subtitle?: string;
}

// Helper — pull rows out of a Drizzle `db.execute()` result.
// Neon HTTP returns the array directly; the socket driver returns
// `{ rows }`. Same shim used in `apps/api/src/lib/job-create.ts`.
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] } | null;
  return r?.rows ?? [];
}

function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return ((current - prior) / prior) * 100;
}

function safeRate(completed: number, failed: number): number {
  const total = completed + failed;
  if (total === 0) return 0;
  return (completed / total) * 100;
}

adminStatsRoute.get('/overview', async (c) => {
  const db = c.var.db;
  const now = new Date();

  // Time anchors. Compute once, reuse across queries — every query
  // gets the same "now" so the dashboard is internally consistent
  // even if Postgres replication lag slips a few ms.
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const prior24h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const next7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const stuckThreshold = new Date(now.getTime() - 10 * 60 * 1000);

  // Parallel fetch — keeps total wall-time near the slowest single
  // query. Neon HTTP holds 6 connections per worker isolate by
  // default, well above what we need here.
  const [
    liveJobsRow,
    topErrorRows,
    openReportsRow,
    todayJobsRow,
    todaySignupsRow,
    todayDauRow,
    todayCreditsRow,
    successRow,
    templateCountsRow,
    topTemplateRow,
    emptyCategoriesRow,
    userCountsRow,
    powerUsersRow,
    recentSignups,
    recentFailedJobs,
    recentReports,
    recentPublishes,
    recentCreditGrants,
    recentAuditEntries,
  ] = await Promise.all([
    // 1. Live jobs aggregate — single scan over open + recent rows.
    db.execute<{
      processing: number;
      queued: number;
      stuck: number;
      failed_24h: number;
      failed_1h: number;
      queued_oldest_age_sec: number | null;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
        COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
        COUNT(*) FILTER (WHERE status = 'processing' AND created_at < ${stuckThreshold})::int AS stuck,
        COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= ${last24h})::int AS failed_24h,
        COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= ${oneHourAgo})::int AS failed_1h,
        COALESCE(
          EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'queued')))::int,
          0
        ) AS queued_oldest_age_sec
      FROM jobs
      WHERE status IN ('processing', 'queued')
         OR created_at >= ${last24h}
    `),

    // 2. Top failure error codes in last 24h.
    db.execute<{ code: string; count: number }>(sql`
      SELECT
        (error->>'code') AS code,
        COUNT(*)::int AS count
      FROM jobs
      WHERE status = 'failed'
        AND created_at >= ${last24h}
        AND error IS NOT NULL
        AND error->>'code' IS NOT NULL
      GROUP BY (error->>'code')
      ORDER BY count DESC
      LIMIT 3
    `),

    // 3. Open reports + oldest age.
    db.execute<{ open_count: number; oldest_age_hr: number | null }>(sql`
      SELECT
        COUNT(*)::int AS open_count,
        EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::int AS oldest_age_sec
      FROM reports
      WHERE status = 'open'
    `).then((r) => {
      const row = rowsOf<{ open_count: number; oldest_age_sec: number | null }>(r)[0];
      return {
        open_count: row?.open_count ?? 0,
        oldest_age_hr:
          row?.oldest_age_sec != null ? row.oldest_age_sec / 3600 : null,
      };
    }),

    // 4. Today vs prior-day generations.
    db.execute<{ today: number; prior: number }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${last24h})::int AS today,
        COUNT(*) FILTER (
          WHERE created_at >= ${prior24h} AND created_at < ${last24h}
        )::int AS prior
      FROM jobs
      WHERE created_at >= ${prior24h}
    `),

    // 5. Today vs prior-day signups.
    db.execute<{ today: number; prior: number }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${last24h})::int AS today,
        COUNT(*) FILTER (
          WHERE created_at >= ${prior24h} AND created_at < ${last24h}
        )::int AS prior
      FROM users
      WHERE created_at >= ${prior24h}
    `),

    // 6. DAU = distinct users who submitted ≥1 job in window.
    db.execute<{ today: number; prior: number }>(sql`
      SELECT
        COUNT(DISTINCT user_id) FILTER (WHERE created_at >= ${last24h})::int AS today,
        COUNT(DISTINCT user_id) FILTER (
          WHERE created_at >= ${prior24h} AND created_at < ${last24h}
        )::int AS prior
      FROM jobs
      WHERE created_at >= ${prior24h}
    `),

    // 7. Credits spent — sum of negative ledger deltas.
    // We negate so the value is positive ("spent today: 120").
    db.execute<{ today: number; prior: number }>(sql`
      SELECT
        COALESCE(SUM(-delta) FILTER (
          WHERE delta < 0 AND created_at >= ${last24h}
        ), 0)::int AS today,
        COALESCE(SUM(-delta) FILTER (
          WHERE delta < 0 AND created_at >= ${prior24h} AND created_at < ${last24h}
        ), 0)::int AS prior
      FROM credit_ledger
      WHERE created_at >= ${prior24h}
    `),

    // 8. Success rate today vs yesterday.
    db.execute<{
      completed_today: number;
      failed_today: number;
      completed_prior: number;
      failed_prior: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE status='completed' AND created_at >= ${last24h})::int AS completed_today,
        COUNT(*) FILTER (WHERE status='failed' AND created_at >= ${last24h})::int AS failed_today,
        COUNT(*) FILTER (
          WHERE status='completed' AND created_at >= ${prior24h} AND created_at < ${last24h}
        )::int AS completed_prior,
        COUNT(*) FILTER (
          WHERE status='failed' AND created_at >= ${prior24h} AND created_at < ${last24h}
        )::int AS failed_prior
      FROM jobs
      WHERE created_at >= ${prior24h}
        AND status IN ('completed', 'failed')
    `),

    // 9. Template counts (total / published / draft).
    db.execute<{ total: number; published: number; draft: number }>(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status='published')::int AS published,
        COUNT(*) FILTER (WHERE status='draft')::int AS draft
      FROM templates
    `),

    // 10. Top template in last 24h.
    db.execute<{ id: string; title: string; runs: number }>(sql`
      SELECT t.id, t.title, COUNT(*)::int AS runs
      FROM jobs j
      JOIN templates t ON t.id = j.template_id
      WHERE j.created_at >= ${last24h}
        AND j.status IN ('completed', 'processing')
      GROUP BY t.id, t.title
      ORDER BY runs DESC
      LIMIT 1
    `),

    // 11. Categories with no published templates (UX gap signal).
    db.execute<{ empty: number }>(sql`
      SELECT COUNT(*)::int AS empty
      FROM categories c
      WHERE NOT EXISTS (
        SELECT 1 FROM templates t
        WHERE t.category_id = c.id AND t.status = 'published'
      )
    `),

    // 12. User aggregates.
    db.execute<{
      total: number;
      paid: number;
      renewing_next7d: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE is_deleted = false)::int AS total,
        COUNT(*) FILTER (
          WHERE is_deleted = false AND entitlement <> 'free'
        )::int AS paid,
        COUNT(*) FILTER (
          WHERE subscription_renews_at IS NOT NULL
            AND subscription_renews_at BETWEEN NOW() AND ${next7d}
        )::int AS renewing_next7d
      FROM users
    `),

    // 13. Power users — ≥10 jobs in last 30 days.
    db.execute<{ power_users: number }>(sql`
      SELECT COUNT(*)::int AS power_users
      FROM (
        SELECT user_id
        FROM jobs
        WHERE created_at >= ${last30d}
        GROUP BY user_id
        HAVING COUNT(*) >= 10
      ) sub
    `),

    // ── Activity feed: pull last 5 from each source, merge in JS.
    // 14. Recent signups.
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.isDeleted, false), gt(users.createdAt, last7d)))
      .orderBy(desc(users.createdAt))
      .limit(5),

    // 15. Recent failed jobs.
    db
      .select({
        id: jobs.id,
        userId: jobs.userId,
        templateId: jobs.templateId,
        error: jobs.error,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .where(and(eq(jobs.status, 'failed'), gt(jobs.createdAt, oneHourAgo)))
      .orderBy(desc(jobs.createdAt))
      .limit(5),

    // 16. Recent open reports.
    db
      .select({
        id: reports.id,
        targetType: reports.targetType,
        reason: reports.reason,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(eq(reports.status, 'open'))
      .orderBy(desc(reports.createdAt))
      .limit(5),

    // 17. Recently published templates.
    db
      .select({
        id: templates.id,
        title: templates.title,
        publishedAt: templates.publishedAt,
      })
      .from(templates)
      .where(
        and(eq(templates.status, 'published'), isNotNull(templates.publishedAt)),
      )
      .orderBy(desc(templates.publishedAt))
      .limit(5),

    // 18. Big credit grants (purchases / admin adjusts).
    db.execute<{
      id: string;
      user_id: string;
      delta: number;
      reason: string;
      created_at: string;
    }>(sql`
      SELECT id, user_id, delta, reason, created_at
      FROM credit_ledger
      WHERE delta > 0
        AND reason IN ('purchase', 'admin_adjust', 'subscription_grant')
        AND created_at >= ${last7d}
      ORDER BY created_at DESC
      LIMIT 5
    `),

    // 19. Admin actions (already populated by withAdmin middleware).
    db
      .select({
        id: adminAuditLog.id,
        method: adminAuditLog.method,
        path: adminAuditLog.path,
        resourceId: adminAuditLog.resourceId,
        createdAt: adminAuditLog.createdAt,
      })
      .from(adminAuditLog)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(5),
  ]);

  // ── Reduce raw rows to typed payload ────────────────────────────
  const liveRow = rowsOf<{
    processing: number;
    queued: number;
    stuck: number;
    failed_24h: number;
    failed_1h: number;
    queued_oldest_age_sec: number | null;
  }>(liveJobsRow)[0] ?? {
    processing: 0,
    queued: 0,
    stuck: 0,
    failed_24h: 0,
    failed_1h: 0,
    queued_oldest_age_sec: 0,
  };

  const todayJobs = rowsOf<{ today: number; prior: number }>(todayJobsRow)[0] ?? {
    today: 0,
    prior: 0,
  };
  const todaySignups = rowsOf<{ today: number; prior: number }>(todaySignupsRow)[0] ?? {
    today: 0,
    prior: 0,
  };
  const todayDau = rowsOf<{ today: number; prior: number }>(todayDauRow)[0] ?? {
    today: 0,
    prior: 0,
  };
  const todayCredits = rowsOf<{ today: number; prior: number }>(todayCreditsRow)[0] ?? {
    today: 0,
    prior: 0,
  };
  const success = rowsOf<{
    completed_today: number;
    failed_today: number;
    completed_prior: number;
    failed_prior: number;
  }>(successRow)[0] ?? {
    completed_today: 0,
    failed_today: 0,
    completed_prior: 0,
    failed_prior: 0,
  };
  const tmplCounts = rowsOf<{ total: number; published: number; draft: number }>(
    templateCountsRow,
  )[0] ?? { total: 0, published: 0, draft: 0 };
  const topTemplate = rowsOf<{ id: string; title: string; runs: number }>(
    topTemplateRow,
  )[0] ?? null;
  const emptyCats =
    rowsOf<{ empty: number }>(emptyCategoriesRow)[0]?.empty ?? 0;
  const userCounts = rowsOf<{
    total: number;
    paid: number;
    renewing_next7d: number;
  }>(userCountsRow)[0] ?? { total: 0, paid: 0, renewing_next7d: 0 };
  const powerUsers =
    rowsOf<{ power_users: number }>(powerUsersRow)[0]?.power_users ?? 0;

  const successToday = safeRate(success.completed_today, success.failed_today);
  const successPrior = safeRate(success.completed_prior, success.failed_prior);

  // ── Activity feed ──────────────────────────────────────────────
  // Each source contributes ≤5 events; we merge, sort by timestamp,
  // take 10. Event titles use minimal PII (email is fine for admin
  // surface, full names are not always populated).
  const activity: ActivityItem[] = [];

  for (const u of recentSignups) {
    activity.push({
      type: 'signup',
      at: u.createdAt.toISOString(),
      href: `/admin/users?search=${encodeURIComponent(u.email)}`,
      title: 'New signup',
      subtitle: u.name ? `${u.name} · ${u.email}` : u.email,
    });
  }

  for (const j of recentFailedJobs) {
    const code = j.error?.code ?? 'error';
    activity.push({
      type: 'job_failed',
      at: j.createdAt.toISOString(),
      href: `/admin/jobs?status=failed`,
      title: `Job failed — ${code}`,
      subtitle: j.error?.message ?? 'No error message',
    });
  }

  for (const r of recentReports) {
    activity.push({
      type: 'report_opened',
      at: r.createdAt.toISOString(),
      href: `/admin/reports`,
      title: `Report opened — ${r.reason}`,
      subtitle: `Target: ${r.targetType}`,
    });
  }

  for (const t of recentPublishes) {
    if (!t.publishedAt) continue;
    activity.push({
      type: 'template_published',
      at: t.publishedAt.toISOString(),
      href: `/admin/templates/${t.id}`,
      title: 'Template published',
      subtitle: t.title,
    });
  }

  for (const g of rowsOf<{
    id: string;
    user_id: string;
    delta: number;
    reason: string;
    created_at: string;
  }>(recentCreditGrants)) {
    activity.push({
      type: 'credit_grant',
      at: g.created_at,
      href: `/admin/users`,
      title: `Credits +${g.delta}`,
      subtitle: g.reason.replace(/_/g, ' '),
    });
  }

  for (const a of recentAuditEntries) {
    activity.push({
      type: 'admin_action',
      at: a.createdAt.toISOString(),
      href: a.path,
      title: `Admin: ${a.method} ${a.path}`,
      subtitle: a.resourceId ?? undefined,
    });
  }

  activity.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const activityTop = activity.slice(0, 10);

  // ── Final payload ──────────────────────────────────────────────
  const payload: AdminStatsOverview = {
    generatedAt: now.toISOString(),
    live: {
      jobsProcessing: liveRow.processing,
      jobsQueued: liveRow.queued,
      queuedOldestAgeSec:
        liveRow.queued > 0 ? liveRow.queued_oldest_age_sec : null,
      failedLastHour: liveRow.failed_1h,
      failedLast24h: liveRow.failed_24h,
      stuckJobs: liveRow.stuck,
      topErrorCodes: rowsOf<{ code: string; count: number }>(topErrorRows),
      openReports: openReportsRow.open_count,
      openReportsOldestAgeHr: openReportsRow.oldest_age_hr,
    },
    today: {
      generations: {
        value: todayJobs.today,
        deltaPct: pctDelta(todayJobs.today, todayJobs.prior),
      },
      newSignups: {
        value: todaySignups.today,
        deltaPct: pctDelta(todaySignups.today, todaySignups.prior),
      },
      activeUsers: {
        value: todayDau.today,
        deltaPct: pctDelta(todayDau.today, todayDau.prior),
      },
      creditsSpent: {
        value: todayCredits.today,
        deltaPct: pctDelta(todayCredits.today, todayCredits.prior),
      },
      successRatePct: {
        value: Number(successToday.toFixed(1)),
        deltaPct: pctDelta(successToday, successPrior),
      },
    },
    catalog: {
      templatesTotal: tmplCounts.total,
      templatesPublished: tmplCounts.published,
      templatesDraft: tmplCounts.draft,
      topTemplate24h: topTemplate
        ? { id: topTemplate.id, title: topTemplate.title, runs: topTemplate.runs }
        : null,
      categoriesEmpty: emptyCats,
    },
    users: {
      total: userCounts.total,
      paid: userCounts.paid,
      powerUsers30d: powerUsers,
      renewingNext7d: userCounts.renewing_next7d,
    },
    activity: activityTop,
  };

  // Hint clients: the data is fresh at request time but we expect
  // dashboards to poll. 30s is the React Query staleTime on the
  // admin side, so no point telling the browser cache to keep it
  // longer.
  c.header('Cache-Control', 'private, max-age=30');
  return c.json({ data: payload });
});
