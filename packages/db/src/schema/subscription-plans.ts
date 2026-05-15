/**
 * `subscription_plans` — auto-renewable IAPs that grant a per-period
 * credit allowance and an entitlement.
 *
 * One row per App Store / Play Store productId. The RC webhook on a
 * grant event (INITIAL_PURCHASE / RENEWAL / PRODUCT_CHANGE /
 * UNCANCELLATION) looks up the productId here, sets the user's
 * entitlement, zeros out leftover `subscription_credits`, and grants
 * `credits_per_period` to the `subscription_credits` bucket.
 *
 * `interval_unit` is plain text (`'week' | 'month' | 'year'`) to keep
 * the table aligned with how Apple/RevenueCat describe subscription
 * billing intervals — promoting to a Postgres enum would force a
 * migration the next time Apple introduces a new interval, which
 * happens.
 */

import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { entitlementEnum } from './enums';
import { users } from './users';

export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeProductId: text('store_product_id').notNull().unique(),
    displayName: text('display_name').notNull(),

    entitlement: entitlementEnum('entitlement').notNull(),
    intervalUnit: text('interval_unit').notNull(),
    intervalCount: integer('interval_count').default(1).notNull(),
    creditsPerPeriod: integer('credits_per_period').notNull(),

    displayOrder: integer('display_order').default(0).notNull(),
    isFeatured: boolean('is_featured').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),

    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedByAdminId: uuid('updated_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [index('subscription_plans_active_order_idx').on(t.isActive, t.displayOrder)],
);

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type NewSubscriptionPlan = typeof subscriptionPlans.$inferInsert;
