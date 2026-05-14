/**
 * Audit log of every RevenueCat webhook event we receive.
 *
 * Why a dedicated table instead of just mutating `users` on the fly:
 *   1. RC re-sends webhooks for ~7 days on failure, so we need an
 *      idempotency key per event to safely deduplicate retries. RC
 *      provides a UUID on every event — we store it as the table's
 *      `eventId` UNIQUE column.
 *   2. Disputes happen weeks after the fact ("why did my subscription
 *      flip back to free?"). Having the raw payload preserved makes
 *      these trivial to reconstruct.
 *   3. If we ever change how an event maps to `users.entitlement`,
 *      we can replay the audit log against the new logic without
 *      asking RC to resend anything.
 *
 * Schema choices:
 *   - `appUserId` is the value RC passed back (we set it to the
 *     internal `users.id` UUID via `Purchases.logIn()` on the mobile
 *     side — see docs/revenuecat.md). Indexed for the admin user
 *     drilldown.
 *   - `payload` keeps the full webhook body. Small (<2KB typical) and
 *     forensically priceless.
 *   - `processedAt` is set when the handler finishes applying the
 *     event to `users`. If null, the event was received but
 *     processing failed — surfaced in the admin queue.
 *   - `processingError` captures the failure message so an operator
 *     can decide whether to manually retry.
 */

import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const revenuecatEvents = pgTable(
  'revenuecat_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** UUID from `event.id` in the RC webhook body — primary dedupe key. */
    eventId: text('event_id').notNull().unique(),
    /** RC event type: INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, etc. */
    eventType: text('event_type').notNull(),
    /** `app_user_id` from the event — should match `users.id` once we logIn() on mobile. */
    appUserId: text('app_user_id').notNull(),
    /** Resolved internal user (null if we couldn't match the app_user_id to a row). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Productthe event refers to, e.g. `clickefy_monthly`. */
    productId: text('product_id'),
    /** Entitlement string from RC, e.g. `Clickefy.Ai Pro`. */
    entitlementId: text('entitlement_id'),
    /** Full webhook body for audit / replay. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),

    /** Set when the handler finished applying the event to `users`. */
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** Failure message when `processedAt` is null. */
    processingError: text('processing_error'),

    /** Time RC reports for the event (`event.event_timestamp_ms`). */
    eventOccurredAt: timestamp('event_occurred_at', { withTimezone: true }).notNull(),
    /** When we received the webhook. */
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    // Admin queue: events still needing processing, newest first.
    index('rc_events_unprocessed_idx').on(t.processedAt, t.createdAt.desc()),
    // Drilldown by user.
    index('rc_events_user_idx').on(t.userId, t.createdAt.desc()),
    // Audit search by app user id (covers the case where userId is null).
    index('rc_events_app_user_idx').on(t.appUserId, t.createdAt.desc()),
  ],
);

export type RevenueCatEvent = typeof revenuecatEvents.$inferSelect;
export type NewRevenueCatEvent = typeof revenuecatEvents.$inferInsert;
