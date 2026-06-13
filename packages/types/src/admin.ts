/**
 * Admin RBAC — the single shared source of truth for roles, page keys,
 * role defaults, and effective-page computation.
 *
 * Defined in `@clickfy/types` (not `@clickfy/db`) so both the API Worker
 * and the Next.js admin app can import the exact same matrix without
 * pulling in Drizzle. Authorization is then enforced server-side (API)
 * and mirrored client-side (sidebar/route guard) from one definition —
 * there is never a second, drift-prone copy of "who can see what".
 *
 * Design (2026 RBAC best practice): permissions are modeled as
 * *capabilities* (page keys), not as a tangle of per-route booleans.
 * A user's effective pages are derived once per request as:
 *
 *     effective = (role_default ∪ user_grants) − user_revokes
 *
 * Role is decoupled from billing `entitlement` — see
 * `packages/db/src/schema/users.ts`.
 */

/**
 * The three fixed admin roles. A user with no role (`admin_role IS NULL`)
 * is not staff at all and cannot reach the admin surface.
 *
 *   - `superadmin` — full access incl. Team + Monitoring; can manage
 *     other staff's roles and page overrides.
 *   - `admin`      — every page except the two superadmin-only ones.
 *   - `creator`    — content authoring only (templates + categories).
 */
export type AdminRole = 'superadmin' | 'admin' | 'creator';

export const ADMIN_ROLES: readonly AdminRole[] = ['superadmin', 'admin', 'creator'] as const;

/**
 * One key per sidebar section. Keep aligned with the nav in
 * `apps/admin/components/layout/app-sidebar.tsx` and the route-group →
 * page mapping enforced in the API (`withAdmin({ page })`).
 */
export type AdminPageKey =
  | 'dashboard'
  | 'templates'
  | 'home'
  | 'categories'
  | 'users'
  | 'jobs'
  | 'reports'
  | 'push'
  | 'credits'
  | 'analytics'
  | 'settings'
  | 'team'
  | 'monitoring';

export const ADMIN_PAGE_KEYS: readonly AdminPageKey[] = [
  'dashboard',
  'templates',
  'home',
  'categories',
  'users',
  'jobs',
  'reports',
  'push',
  'credits',
  'analytics',
  'settings',
  'team',
  'monitoring',
] as const;

/**
 * Pages that are reserved for superadmins and can NEVER be granted to a
 * lower role via an override. The Team UI and the API both refuse to put
 * these keys into anyone else's `grant` list.
 */
export const SUPERADMIN_ONLY_PAGES: readonly AdminPageKey[] = ['team', 'monitoring'] as const;

/**
 * Default page set per role, defined in code (not the DB) so the matrix
 * is versioned with the app and a deploy is all it takes to adjust it.
 */
export const ROLE_DEFAULT_PAGES: Record<AdminRole, readonly AdminPageKey[]> = {
  superadmin: ADMIN_PAGE_KEYS,
  admin: ADMIN_PAGE_KEYS.filter((p) => !SUPERADMIN_ONLY_PAGES.includes(p)),
  creator: ['templates', 'categories'],
};

/**
 * Per-user page overrides layered on top of the role default. Stored as
 * JSONB on `users.admin_page_overrides`. `grant` adds pages; `revoke`
 * removes them. Superadmin-only pages are filtered out of `grant` when
 * the effective set is computed, so a stale/hand-edited override can
 * never escalate a creator into Team/Monitoring.
 */
export interface AdminPageOverrides {
  grant: AdminPageKey[];
  revoke: AdminPageKey[];
}

export const EMPTY_PAGE_OVERRIDES: AdminPageOverrides = { grant: [], revoke: [] };

/**
 * Loose input shape for the normaliser — accepts raw `string[]` straight
 * from DB JSONB or a request body, which haven't been narrowed yet.
 */
export interface PageOverridesInput {
  grant?: readonly string[];
  revoke?: readonly string[];
}

function isAdminPageKey(value: string): value is AdminPageKey {
  return (ADMIN_PAGE_KEYS as readonly string[]).includes(value);
}

/**
 * Normalise an untrusted overrides value (DB JSONB / request body) into a
 * well-formed `AdminPageOverrides` containing only known page keys.
 */
export function normalizePageOverrides(
  value: PageOverridesInput | null | undefined,
): AdminPageOverrides {
  const grant = (value?.grant ?? []).filter((p): p is AdminPageKey => isAdminPageKey(p));
  const revoke = (value?.revoke ?? []).filter((p): p is AdminPageKey => isAdminPageKey(p));
  return { grant, revoke };
}

/**
 * Resolve the effective page set for a user.
 *
 *   effective = (role_default ∪ grant) − revoke
 *
 * Invariants:
 *   - Superadmin always has every page; overrides cannot reduce it (a
 *     superadmin must never be able to lock themselves out of Team).
 *   - Superadmin-only pages are never added to a non-superadmin via
 *     `grant`, regardless of what the override JSON says.
 *   - Result preserves the canonical `ADMIN_PAGE_KEYS` order.
 */
export function computeEffectivePages(
  role: AdminRole,
  overrides: PageOverridesInput | null | undefined,
): AdminPageKey[] {
  if (role === 'superadmin') return [...ADMIN_PAGE_KEYS];

  const { grant, revoke } = normalizePageOverrides(overrides);
  const set = new Set<AdminPageKey>(ROLE_DEFAULT_PAGES[role]);

  for (const page of grant) {
    if (SUPERADMIN_ONLY_PAGES.includes(page)) continue;
    set.add(page);
  }
  for (const page of revoke) {
    set.delete(page);
  }

  return ADMIN_PAGE_KEYS.filter((p) => set.has(p));
}

/**
 * Payload of `GET /v1/admin/me` — the permission context the dashboard
 * loads once on boot and uses to gate navigation + render the footer.
 */
export interface AdminMe {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: AdminRole;
  pages: AdminPageKey[];
}

// ─── Team / Roles management ────────────────────────────────────────

/** One staff member as shown in the superadmin Team page. */
export interface AdminTeamMember {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: AdminRole;
  /** Raw stored overrides (grant/revoke). */
  overrides: AdminPageOverrides;
  /** Resolved effective pages (role default + grant − revoke). */
  pages: AdminPageKey[];
  createdAt: string;
  lastSeenAt: string;
}

export interface AdminTeamListResponse {
  data: AdminTeamMember[];
}

/** Body for `PATCH /v1/admin/team/:id/role`. */
export interface SetAdminRoleInput {
  role: AdminRole;
}

/** Body for `PATCH /v1/admin/team/:id/pages`. */
export interface SetAdminPagesInput {
  grant: AdminPageKey[];
  revoke: AdminPageKey[];
}

/** Body for `POST /v1/admin/team/:id/promote`. */
export interface PromoteStaffInput {
  role: AdminRole;
}

// ─── Monitoring ─────────────────────────────────────────────────────

/** A published template with its publisher attribution. */
export interface MonitoringPublishedTemplate {
  id: string;
  title: string;
  kind: 'image' | 'video' | 'image_set';
  publishedAt: string | null;
  versionCount: number;
  /** Null when the publisher row was hard-deleted (`Unattributed`). */
  publisherId: string | null;
  publisherName: string | null;
  publisherEmail: string | null;
}

export interface MonitoringPublishedTemplatesResponse {
  data: MonitoringPublishedTemplate[];
  meta: { total: number; limit: number; offset: number; hasMore: boolean };
}

/** Per-admin publish leaderboard row. */
export interface MonitoringAdminMetric {
  adminId: string | null;
  name: string | null;
  email: string | null;
  role: AdminRole | null;
  total: number;
  last7d: number;
  last30d: number;
  /** Publishes in the PREVIOUS 7d window (days 8–14 ago) for WoW deltas. */
  prev7d: number;
  /** Publishes in the PREVIOUS 30d window (days 31–60 ago) for MoM deltas. */
  prev30d: number;
  /** Publishes within the custom window, present only when one was requested. */
  custom?: number;
}

/** Aggregate headline numbers for the monitoring Overview tab. */
export interface MonitoringSummary {
  /** Distinct templates currently in `published` status. */
  publishedTemplates: number;
  /** Total publish actions ever (every `template_versions` row). */
  totalPublishes: number;
  thisWeek: number;
  lastWeek: number;
  thisMonth: number;
  lastMonth: number;
  /** Number of admins with at least one attributed publish. */
  activePublishers: number;
}

export interface MonitoringAdminMetricsResponse {
  data: MonitoringAdminMetric[];
  summary: MonitoringSummary;
  window: { from: string | null; to: string | null };
}

/** A single human-readable activity-feed entry derived from the audit log. */
export interface MonitoringActivityEntry {
  id: string;
  adminId: string | null;
  adminName: string | null;
  adminEmail: string | null;
  method: string;
  path: string;
  resourceId: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface MonitoringActivityResponse {
  data: MonitoringActivityEntry[];
  meta: { total: number; limit: number; offset: number; hasMore: boolean };
}
