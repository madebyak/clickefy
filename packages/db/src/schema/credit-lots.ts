import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * The spend class a lot belongs to. The allocator branches on this — top-up
 * credits are only spendable while the user has an active subscription —
 * so unlike `kind` it is constrained at the database level.
 */
export type CreditLotClass = 'promo' | 'subscription' | 'topup';

/**
 * Where a lot came from. Free-form provenance for auditing and reporting;
 * deliberately NOT constrained, so adding a new grant source never needs a
 * migration.
 */
export type CreditLotKind =
  | 'welcome'
  | 'subscription'
  | 'topup'
  | 'admin'
  | 'refund'
  | 'migrated';

/**
 * `credit_lots` — one row per credit-issuing event (migration 0029).
 *
 * Replaces "three integers on `users`" as the *truth* about a user's
 * credits. The three columns survive as a maintained projection so balance
 * reads stay a single row and the 0015 CHECK still applies; every statement
 * that moves a lot must update that projection in the same statement.
 *
 * Two properties make this worth the extra table:
 *
 *   1. Per-grant expiry. Two top-up packs bought months apart have two
 *      different expiry dates, which a single integer cannot express.
 *   2. The spend-priority rule collapses into one ORDER BY —
 *      `expires_at ASC NULLS LAST, created_at ASC`. Subscription credits
 *      expire at period end so they go first, top-ups (12 months) second,
 *      welcome credits (never) last. That is the agreed order, derived
 *      from a single principle instead of hardcoded.
 */
export const creditLots = pgTable(
  'credit_lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    class: text('class').$type<CreditLotClass>().notNull(),
    kind: text('kind').$type<CreditLotKind>().notNull(),
    amountGranted: integer('amount_granted').notNull(),
    amountRemaining: integer('amount_remaining').notNull(),
    /** NULL = never expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /**
     * Set while the expiry clock is stopped (user unsubscribed). `expiresAt`
     * is cleared and the life left parked in `remainingLifetime`, then
     * rebuilt as `now() + remainingLifetime` when they resubscribe.
     */
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    /** Postgres `interval`; only meaningful while `pausedAt` is set. */
    remainingLifetime: text('remaining_lifetime'),
    /** 'stripe' | 'app_store' | 'play_store' | 'admin' | 'system'. */
    sourcePlatform: text('source_platform'),
    /**
     * The external event / transaction this grant came from. Combined with
     * `(user_id, kind)` in a partial unique index, this is what makes a
     * replayed webhook a no-op instead of a double grant.
     */
    sourceRef: text('source_ref'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    // Allocator: this user's eligible lots, soonest expiry first. Partial —
    // spent-out lots are never candidates and would otherwise dominate the
    // index as history accumulates.
    index('credit_lots_alloc_idx')
      .on(t.userId, t.expiresAt, t.createdAt)
      .where(sql`${t.amountRemaining} > 0`),
    index('credit_lots_expiry_sweep_idx')
      .on(t.expiresAt)
      .where(sql`${t.amountRemaining} > 0 AND ${t.expiresAt} IS NOT NULL`),
    index('credit_lots_paused_idx')
      .on(t.userId)
      .where(sql`${t.pausedAt} IS NOT NULL`),
    uniqueIndex('credit_lots_source_ref_uq')
      .on(t.userId, t.kind, t.sourceRef)
      .where(sql`${t.sourceRef} IS NOT NULL`),
    check('credit_lots_class_check', sql`${t.class} IN ('promo', 'subscription', 'topup')`),
    check('credit_lots_granted_positive', sql`${t.amountGranted} > 0`),
    check(
      'credit_lots_remaining_range',
      sql`${t.amountRemaining} >= 0 AND ${t.amountRemaining} <= ${t.amountGranted}`,
    ),
    // A paused lot must have parked its remaining life AND have no live
    // expiry; an unpaused lot must have neither. Without this a
    // half-applied pause makes credits eternal.
    check(
      'credit_lots_pause_coherent',
      sql`(${t.pausedAt} IS NULL AND ${t.remainingLifetime} IS NULL)
          OR (${t.pausedAt} IS NOT NULL AND ${t.remainingLifetime} IS NOT NULL AND ${t.expiresAt} IS NULL)`,
    ),
  ],
);

export type CreditLot = typeof creditLots.$inferSelect;
export type NewCreditLot = typeof creditLots.$inferInsert;
