/**
 * `credit_packs` — non-renewing consumable IAPs that grant credits.
 *
 * One row per App Store / Play Store productId. The RC webhook on a
 * `NON_RENEWING_PURCHASE` event looks up the productId here and grants
 * `credits + bonus_credits` to the user's `topup_credits` bucket.
 *
 * Admins manage rows from `/admin/credits/packs`. The mobile store
 * screen reads only active rows ordered by `display_order` from
 * `GET /v1/store`. Pricing is NOT stored here — App Store / Play Store
 * is the source of truth, surfaced to the client via RevenueCat's
 * localised `priceString`.
 */

import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

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
