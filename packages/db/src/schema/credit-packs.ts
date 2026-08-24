/**
 * `credit_packs` — non-renewing consumable IAPs that grant credits.
 *
 * One row per App Store / Play Store productId. The RC webhook on a
 * `NON_RENEWING_PURCHASE` event looks up the productId here and grants
 * `credits + bonus_credits` to the user's `topup_credits` bucket.
 *
 * Admins manage rows from `/admin/credits/packs`. The mobile store
 * screen reads only active rows ordered by `display_order` from
 * `GET /v1/store`.
 *
 * PRICING lives in `pack_products` (0033), one row per storefront. On
 * Apple and Google the store remains the source of truth and the client
 * shows RevenueCat's localised `priceString`; `price_usd` there is our
 * own record of what we set. On Stripe WE create the price, so that
 * column is authoritative for web.
 */

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
import type { BillingPlatform } from './plans';

export const creditPacks = pgTable(
  'credit_packs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeProductId: text('store_product_id').notNull().unique(),
    displayName: text('display_name').notNull(),

    credits: integer('credits').notNull(),
    bonusCredits: integer('bonus_credits').default(0).notNull(),

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
  (t) => [index('credit_packs_active_order_idx').on(t.isActive, t.displayOrder)],
);

export type CreditPack = typeof creditPacks.$inferSelect;
export type NewCreditPack = typeof creditPacks.$inferInsert;

/**
 * `pack_products` — how a credit pack is sold on one storefront (0033).
 *
 * The pack's CREDITS live on `credit_packs` and nowhere else; only the
 * identifier and the price vary per platform. Same split, and the same
 * reasoning, as `plan_products`: two numbers that must never differ
 * should not be stored once per storefront.
 *
 * `price_usd` exists because Stripe has no price of its own to read back
 * at grant time — we create it, so we record it. Mobile is priced higher
 * to net the same after the store's 15% commission.
 */
export const packProducts = pgTable(
  'pack_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packId: uuid('pack_id')
      .references(() => creditPacks.id, { onDelete: 'cascade' })
      .notNull(),
    platform: text('platform').$type<BillingPlatform>().notNull(),
    storeProductId: text('store_product_id').notNull(),
    priceUsd: numeric('price_usd', { precision: 10, scale: 2 }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => [
    // One storefront identifier can only ever mean one pack.
    unique('pack_products_platform_product_uq').on(t.platform, t.storeProductId),
    unique('pack_products_pack_platform_uq').on(t.packId, t.platform),
    index('pack_products_pack_idx').on(t.packId),
    check(
      'pack_products_platform_check',
      sql`${t.platform} IN ('stripe', 'app_store', 'play_store')`,
    ),
  ],
);
