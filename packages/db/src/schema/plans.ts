import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

export type PlanTier = 'basic' | 'creator' | 'pro' | 'ultimate';
export type PlanInterval = 'month' | 'year';
export type BillingPlatform = 'stripe' | 'app_store' | 'play_store';

/**
 * `plans` — a sellable plan, independent of where it is sold (0031).
 *
 * The credit allowance lives HERE and nowhere else. The same plan is sold
 * on three storefronts at three prices under three different identifiers,
 * but it must always grant the same credits — keeping that number in one
 * row makes web and mobile incapable of drifting apart, which a row per
 * storefront would eventually allow.
 *
 * `tier` is text rather than the `entitlement` enum on purpose: the two
 * agree today, but binding the catalogue to the enum would mean an enum
 * migration before a new tier could even be drafted.
 */
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tier: text('tier').$type<PlanTier>().notNull(),
    interval: text('interval').$type<PlanInterval>().notNull(),
    /** Credits granted each period, on every platform. */
    creditsPerPeriod: integer('credits_per_period').notNull(),
    displayName: text('display_name').notNull(),
    displayOrder: integer('display_order').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`).notNull(),
    updatedByAdminId: uuid('updated_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    unique('plans_tier_interval_uq').on(t.tier, t.interval),
    index('plans_active_order_idx').on(t.isActive, t.displayOrder),
    check('plans_interval_check', sql`${t.interval} IN ('month', 'year')`),
    check('plans_credits_positive', sql`${t.creditsPerPeriod} > 0`),
  ],
);

/**
 * `plan_products` — how one plan is identified and priced on one
 * storefront.
 *
 * `store_product_id` is what a webhook arrives carrying, so it is unique
 * within its platform: a duplicate would make the plan ambiguous at
 * exactly the moment money changes hands.
 *
 * `price_usd` is display only. The storefront is always the truth for
 * what a customer is actually charged, in their own currency.
 */
export const planProducts = pgTable(
  'plan_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .references(() => plans.id, { onDelete: 'cascade' })
      .notNull(),
    platform: text('platform').$type<BillingPlatform>().notNull(),
    storeProductId: text('store_product_id').notNull(),
    priceUsd: numeric('price_usd', { precision: 10, scale: 2 }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => [
    unique('plan_products_platform_product_uq').on(t.platform, t.storeProductId),
    unique('plan_products_plan_platform_uq').on(t.planId, t.platform),
    index('plan_products_plan_idx').on(t.planId),
    check(
      'plan_products_platform_check',
      sql`${t.platform} IN ('stripe', 'app_store', 'play_store')`,
    ),
  ],
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type PlanProduct = typeof planProducts.$inferSelect;
export type NewPlanProduct = typeof planProducts.$inferInsert;
