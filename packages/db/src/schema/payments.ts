/**
 * `payments` — cash, one row per thing a customer paid for.
 *
 * Stripe is the only writer today: an `invoice.paid` becomes a
 * `subscription` row, a `checkout.session.completed` in payment mode
 * becomes a `pack` row, and `charge.refunded` raises
 * `amount_refunded_cents` on the row whose payment intent it names. The
 * store platforms get the same shape when RevenueCat starts delivering
 * purchases, which is why `platform` is a column and not implied.
 *
 * This is the dashboard's "cash received" line. It is deliberately NOT
 * derived from the credit ledger — a grant says what credits a customer
 * got, not what they paid, and comps pay nothing.
 *
 * `provider_invoices` is the other side: what each AI provider billed
 * us for a month, typed in by an admin, so computed cost can be checked
 * against the real bill.
 */

import { sql } from 'drizzle-orm';
import { date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    platform: text('platform').$type<'stripe' | 'app_store' | 'play_store'>().notNull(),
    kind: text('kind').$type<'subscription' | 'pack'>().notNull(),
    /** Stripe invoice id or checkout session id; the store transaction id later. */
    externalId: text('external_id').notNull(),
    /** Stripe payment intent, when known — how a refund finds its payment. */
    paymentIntentId: text('payment_intent_id'),
    amountCents: integer('amount_cents').notNull(),
    amountRefundedCents: integer('amount_refunded_cents').default(0).notNull(),
    currency: text('currency').default('usd').notNull(),
    /** Credits the payment bought, as granted by the webhook. */
    creditsGranted: integer('credits_granted'),
    /** Price id / pack product id, for grouping. */
    productRef: text('product_ref'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => [
    uniqueIndex('payments_external_idx').on(t.platform, t.externalId),
    index('payments_occurred_idx').on(t.occurredAt),
    index('payments_user_idx').on(t.userId),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

export const providerInvoices = pgTable(
  'provider_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    /** First day of the month the invoice covers. */
    month: date('month').notNull(),
    amountUsd: numeric('amount_usd', { precision: 12, scale: 2 }).notNull(),
    note: text('note'),
    updatedByAdminId: uuid('updated_by_admin_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => [uniqueIndex('provider_invoices_month_idx').on(t.provider, t.month)],
);

export type ProviderInvoice = typeof providerInvoices.$inferSelect;
