/**
 * `users` — one row per signed-up user.
 *
 * Source of truth: identity from Clerk (`clerkUserId`), entitlement +
 * subscription dates mirrored from RevenueCat via webhooks. The credits
 * balance is server-authoritative and updated atomically on every job
 * charge / refund / purchase. The audit trail lives in `credit_ledger`.
 *
 * `purgeAssetsAt` is null while the subscription is active; the
 * RevenueCat webhook sets it to "now + 60d" on expiry. A nightly cron
 * walks rows whose `purgeAssetsAt <= now()` and deletes their R2 + Stream
 * outputs.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  DEFAULT_USER_PREFERENCES,
  type AdminPageOverrides,
  type UserPreferences,
} from '@clickfy/types';

import { adminRoleEnum, entitlementEnum, localeEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clerkUserId: text('clerk_user_id').notNull().unique(),
    // Email uniqueness is enforced via a PARTIAL unique index (see the
    // table-options block below) so that soft-deleted rows don't block
    // re-signup with the same address. Migration 0016 swaps the
    // unconditional UNIQUE for the partial form.
    email: text('email').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    locale: localeEnum('locale').default('en').notNull(),

    entitlement: entitlementEnum('entitlement').default('free').notNull(),

    // ── Staff authorization (decoupled from billing entitlement) ─────
    // `adminRole` is null for normal users; non-null marks the row as
    // staff. The page-capability matrix each role maps to lives in
    // `@clickfy/types`. `adminPageOverrides` layers per-user grants /
    // revokes on top of the role default (tiny cardinality — a handful
    // of admins × ~13 pages — so JSONB beats a join table; override
    // edits are themselves captured in `admin_audit_log`).
    // Added in migration 0019_admin_roles.
    adminRole: adminRoleEnum('admin_role'),
    adminPageOverrides: jsonb('admin_page_overrides').$type<AdminPageOverrides>(),

    // ── Credit buckets (see `CreditBucket` in enums.ts) ──────────────
    // `creditsBalance` is a denormalised sum (promo + subscription +
    // topup) kept in sync by the application on every credit movement.
    // The ledger is the source of truth; the bucket columns let us
    // honour bucket-specific rules (subscription resets on renewal;
    // topup is gated to active subscribers).
    creditsBalance: integer('credits_balance').default(0).notNull(),
    promoCredits: integer('promo_credits').default(0).notNull(),
    subscriptionCredits: integer('subscription_credits').default(0).notNull(),
    topupCredits: integer('topup_credits').default(0).notNull(),

    /** Where this subscription lives, so we can send the user to the right
     *  place to change or cancel it — and refuse to sell it twice. Neither
     *  Apple nor Stripe can see the other; only this row can. */
    subscriptionPlatform: text('subscription_platform').$type<
      'stripe' | 'app_store' | 'play_store' | null
    >(),
    /** The exact product they are on, so a paywall can mark it current. */
    subscriptionProductId: text('subscription_product_id'),
    /** Stripe's identity for this user; set on first web checkout. */
    stripeCustomerId: text('stripe_customer_id'),
    subscriptionRenewsAt: timestamp('subscription_renews_at', { withTimezone: true }),
    subscriptionExpiresAt: timestamp('subscription_expires_at', { withTimezone: true }),

    // ── Per-user preferences (appearance, notifications, …) ──────────
    // Stored as JSONB so we can keep adding toggles (`tipsAndTutorials`,
    // future "sound effects", etc.) without another migration each time.
    // Validated by Zod in the API before write; readers always pipe the
    // value through `withPreferenceDefaults()` to backfill missing keys.
    preferences: jsonb('preferences')
      .$type<UserPreferences>()
      .default(DEFAULT_USER_PREFERENCES)
      .notNull(),

    // Soft-delete + retention.
    isDeleted: boolean('is_deleted').default(false).notNull(),
    purgeAssetsAt: timestamp('purge_assets_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('users_purge_idx').on(t.purgeAssetsAt),
    index('users_entitlement_idx').on(t.entitlement),
    // Staff lookups for the Team page filter on a non-null role; this is
    // a tiny, highly selective set so a plain b-tree index is plenty.
    index('users_admin_role_idx').on(t.adminRole),
    // Email is unique among LIVE users only — soft-deleted rows are
    // excluded so a deleted user can re-sign-up with the same address
    // (App Store guideline 5.1.1(v) requires this flow to work). The
    // `DELETE /v1/users/me` handler still scrambles the email as
    // defense-in-depth; this index is the schema-level guarantee.
    uniqueIndex('users_email_active_unique_idx')
      .on(t.email)
      .where(sql`${t.isDeleted} = false`),
    // Database-level invariant: the denormalised total must always
    // equal the sum of its three buckets. Added by migration 0015
    // after a class of "credits visible but unspendable" bugs caused
    // by paths that wrote `credits_balance` without distributing
    // into the buckets (e.g. the legacy admin credit-adjust handler,
    // and any manual DB edits). Postgres rejects future drift at
    // write time — matching the post-2026-05-14 "fail loud" policy.
    check(
      'users_balance_matches_buckets',
      sql`${t.creditsBalance} = ${t.promoCredits} + ${t.subscriptionCredits} + ${t.topupCredits}`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
