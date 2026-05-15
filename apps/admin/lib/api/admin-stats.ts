/**
 * Client-side wrapper for `GET /v1/admin/stats/overview`.
 *
 * The `AdminStatsOverview` type below MUST stay in sync with the
 * one declared in `apps/api/src/routes/admin-stats.ts`. We don't
 * import from there directly because admin runs in the browser and
 * `apps/api` is a Worker bundle. If we promote `@clickfy/types` to
 * own this shape later, both sides can drop their local copy.
 */

import { apiFetch, type TokenGetter } from '@/lib/api';

export type ActivityType =
  | 'signup'
  | 'job_failed'
  | 'report_opened'
  | 'template_published'
  | 'credit_grant'
  | 'admin_action';

export interface ActivityItem {
  type: ActivityType;
  at: string;
  href: string;
  title: string;
  subtitle?: string;
}

export interface Delta {
  value: number;
  deltaPct: number | null;
}

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
  activity: ActivityItem[];
}

export function fetchAdminStatsOverview(
  getToken: TokenGetter,
): Promise<AdminStatsOverview> {
  return apiFetch<AdminStatsOverview>('/v1/admin/stats/overview', { getToken });
}
