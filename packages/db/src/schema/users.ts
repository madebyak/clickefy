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
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { DEFAULT_USER_PREFERENCES, type UserPreferences } from '@clickfy/types';

import { entitlementEnum, localeEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clerkUserId: text('clerk_user_id').notNull().unique(),
    email: text('email').notNull().unique(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    locale: localeEnum('locale').default('en').notNull(),

    entitlement: entitlementEnum('entitlement').default('free').notNull(),

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
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
