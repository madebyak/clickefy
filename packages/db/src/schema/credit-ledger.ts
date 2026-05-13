/**
 * `credit_ledger` — append-only audit trail for every credit movement.
 *
 * Rules:
 *   - NEVER update or delete a row. Corrections are new rows with the
 *     opposite delta and `reason = 'admin_adjust'` / `'refund'`.
 *   - `balanceAfter` is denormalized so we can reconstruct point-in-time
 *     balances without summing the whole table.
 *   - `users.creditsBalance` is the cached current balance; the ledger
 *     is the source of truth.
 *
 * Common queries:
 *   - "Show me a user's credit history" → `SELECT … WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`
 *   - "Reconcile a user" → `SELECT SUM(delta) FROM credit_ledger WHERE user_id = $1` should equal `users.credits_balance`
 */

import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { creditReasonEnum } from './enums';
import { jobs } from './jobs';
import { users } from './users';

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Signed integer: +20 (purchase), -3 (job charge). */
    delta: integer('delta').notNull(),
    reason: creditReasonEnum('reason').notNull(),

    /** Optional foreign keys for traceability. */
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    revenueCatTransactionId: text('revenuecat_transaction_id'),

    balanceAfter: integer('balance_after').notNull(),

    /**
     * Free-form admin note. Populated when an admin manually grants /
     * deducts credits from the dashboard so we can answer "why did this
     * user get +50 credits last Tuesday?" without spelunking Slack.
     * Null for system-generated rows (job_charge, subscription_grant…).
     */
    note: text('note'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('credit_ledger_user_created_idx').on(t.userId, t.createdAt),
    index('credit_ledger_revenuecat_idx').on(t.revenueCatTransactionId),
  ],
);

export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type NewCreditLedgerEntry = typeof creditLedger.$inferInsert;
