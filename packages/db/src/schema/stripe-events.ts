import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * `stripe_events` — the Stripe webhook log (migration 0032).
 *
 * Mirrors `revenuecat_events`, whose most important property is easy to
 * miss: dedupe is **processing-state-aware**. A replay of a SUCCESSFUL
 * event short-circuits; a replay of a FAILED one re-processes. Stripe
 * retries for up to three days, so that is what turns "the plan wasn't in
 * the catalogue yet" from a permanently lost paid grant into something
 * that heals the moment an operator fixes it.
 *
 * Short-circuiting on `event_id` alone would throw away every retry of a
 * failure — the opposite of what a money path needs.
 */
export const stripeEvents = pgTable(
  'stripe_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stripe's `evt_…`. The idempotency anchor. */
    eventId: text('event_id').notNull().unique(),
    eventType: text('event_type').notNull(),
    /** `cus_…` as it appeared, even when we cannot resolve it to a user yet. */
    stripeCustomerId: text('stripe_customer_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    subscriptionId: text('subscription_id'),
    invoiceId: text('invoice_id'),
    /** The event verbatim. In a dispute, what Stripe sent is what counts. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** NULL while unprocessed OR failed; set only on success. This is the dedupe rule. */
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    eventCreatedAt: timestamp('event_created_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => [
    index('stripe_events_unprocessed_idx').on(t.processedAt, t.createdAt.desc()),
    index('stripe_events_user_idx').on(t.userId, t.createdAt.desc()),
    index('stripe_events_customer_idx').on(t.stripeCustomerId, t.createdAt.desc()),
    index('stripe_events_subscription_idx')
      .on(t.subscriptionId, t.createdAt.desc())
      .where(sql`${t.subscriptionId} IS NOT NULL`),
  ],
);

export type StripeEvent = typeof stripeEvents.$inferSelect;
export type NewStripeEvent = typeof stripeEvents.$inferInsert;
