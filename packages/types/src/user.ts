/**
 * User — profile, plan, and preferences for an end user.
 *
 * Mirrors `packages/db/src/schema/users.ts`. Defined here (not in
 * `@clickfy/db`) so the admin and mobile apps can consume it without
 * pulling in Drizzle.
 *
 * Dates arrive as ISO strings over the wire and stay as strings until a
 * presentation layer parses them.
 */

export type UserLocale = 'en' | 'ar';

export type UserEntitlement = 'free' | 'pro' | 'pro_max' | 'admin';

export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * Accent palette key. Kept aligned with `packages/ui/src/tokens/accents.ts`.
 * If a new accent ships in the UI package, add it here too — the API's
 * Zod validator will reject anything unknown otherwise.
 */
export type ThemeAccent = 'violet' | 'coral' | 'citrus' | 'ocean';

/**
 * Per-user appearance preferences. Stored server-side so a user's
 * theme/accent follows them across devices.
 */
export interface UserAppearancePreferences {
  mode: ThemeMode;
  accent: ThemeAccent;
}

/**
 * Per-user notification preferences. We default everything ON so existing
 * users keep getting transactional emails; users can opt out from the
 * profile screen.
 */
export interface UserNotificationPreferences {
  /** Push/email when a generation job completes. */
  jobCompleted: boolean;
  /** Product announcements, new templates, paywall promos. */
  productUpdates: boolean;
  /** "How to get the most out of Clickfy" content. */
  tipsAndTutorials: boolean;
}

export interface UserPreferences {
  appearance: UserAppearancePreferences;
  notifications: UserNotificationPreferences;
}

/**
 * Canonical defaults — the API stamps this onto the row when a user is
 * created and any reader uses it to backfill missing keys (forward
 * compatibility when we add new toggles in a later release).
 */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  appearance: {
    mode: 'system',
    accent: 'violet',
  },
  notifications: {
    jobCompleted: true,
    productUpdates: true,
    tipsAndTutorials: true,
  },
};

/**
 * Deep-merge helper: takes whatever shape we read from the DB (possibly
 * a partial / outdated structure from an older client) and fills in any
 * missing keys with the current defaults. Pure — does not mutate input.
 */
export function withPreferenceDefaults(
  partial: Partial<UserPreferences> | null | undefined,
): UserPreferences {
  return {
    appearance: {
      ...DEFAULT_USER_PREFERENCES.appearance,
      ...(partial?.appearance ?? {}),
    },
    notifications: {
      ...DEFAULT_USER_PREFERENCES.notifications,
      ...(partial?.notifications ?? {}),
    },
  };
}

/**
 * Patch shape — what `PATCH /v1/users/me` accepts. Every section is
 * optional, and within each section every key is optional. The server
 * deep-merges the patch onto the current row.
 */
export interface UserPreferencesPatch {
  appearance?: Partial<UserAppearancePreferences>;
  notifications?: Partial<UserNotificationPreferences>;
}

/**
 * Body for `PATCH /v1/users/me`. Email is intentionally absent — email
 * changes must go through Clerk's verified flow and are reflected back
 * via the webhook. Avatar is updated through a dedicated upload endpoint.
 */
export interface UpdateProfileInput {
  name?: string;
  locale?: UserLocale;
  preferences?: UserPreferencesPatch;
}

/**
 * `GET /v1/users/me` response payload (the `data` field of the envelope).
 * The shape returned to mobile + admin clients.
 */
export interface MeResponse {
  id: string;
  clerkUserId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  locale: UserLocale;
  entitlement: UserEntitlement;
  creditsBalance: number;
  subscriptionRenewsAt: string | null;
  subscriptionExpiresAt: string | null;
  preferences: UserPreferences;
  createdAt: string;
  lastSeenAt: string;
}

// ─── Admin: users management ────────────────────────────────────────

/**
 * Reasons a row can land in `credit_ledger`. Mirror of the DB enum in
 * `packages/db/src/schema/enums.ts`.
 */
export type CreditReason =
  | 'purchase'
  | 'subscription_grant'
  | 'job_charge'
  | 'refund'
  | 'admin_adjust'
  | 'signup_bonus'
  | 'daily_free';

/**
 * Single row in the admin users table. Augments the Neon `users` row
 * with cheap-to-compute aggregates the dashboard surfaces by default.
 */
export interface AdminUserListItem {
  id: string;
  clerkUserId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  locale: UserLocale;
  entitlement: UserEntitlement;
  creditsBalance: number;
  subscriptionRenewsAt: string | null;
  subscriptionExpiresAt: string | null;
  isDeleted: boolean;
  purgeAssetsAt: string | null;
  createdAt: string;
  lastSeenAt: string;

  /** Lifetime jobs count (all statuses). */
  jobsCount: number;
  /**
   * Lifetime credits spent, expressed as a positive integer.
   * Derived as `-SUM(delta) WHERE delta < 0` so refunds + admin grants
   * don't deflate the spend metric.
   */
  creditsSpent: number;
}

export interface AdminUserListResponse {
  data: AdminUserListItem[];
  nextCursor: string | null;
  total: number | null;
}

/**
 * Subset of Clerk's user record we actually surface in the detail
 * drawer. Pulled live from `@clerk/backend` per request — so reflects
 * current state (banned, MFA, etc.) without webhook lag.
 */
export interface AdminUserClerkSnapshot {
  id: string;
  primaryEmail: string | null;
  primaryEmailVerified: boolean;
  primaryPhone: string | null;
  imageUrl: string | null;
  username: string | null;
  banned: boolean;
  locked: boolean;
  twoFactorEnabled: boolean;
  passwordEnabled: boolean;
  totpEnabled: boolean;
  externalAccounts: Array<{
    provider: string;
    emailAddress: string | null;
  }>;
  lastSignInAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight job summary embedded in the user detail drawer. */
export interface AdminUserJobSummary {
  id: string;
  templateId: string;
  templateTitle: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'purged';
  createdAt: string;
  completedAt: string | null;
}

export interface AdminCreditLedgerEntry {
  id: string;
  delta: number;
  reason: CreditReason;
  balanceAfter: number;
  jobId: string | null;
  revenueCatTransactionId: string | null;
  note: string | null;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserListItem {
  preferences: UserPreferences;
  /** Null when Clerk lookup fails (e.g. user was hard-deleted in Clerk). */
  clerk: AdminUserClerkSnapshot | null;
  recentJobs: AdminUserJobSummary[];
  recentLedger: AdminCreditLedgerEntry[];
}

/** Body for `POST /v1/admin/users/:id/credits`. */
export interface AdjustCreditsInput {
  /** Signed integer. Positive grants credits, negative deducts. */
  delta: number;
  /** Optional human-readable note persisted on the ledger row. */
  note?: string;
}

/** Body for `PATCH /v1/admin/users/:id/entitlement`. */
export interface SetEntitlementInput {
  entitlement: UserEntitlement;
}
