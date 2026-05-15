/**
 * `credit_broadcasts` — historical record of admin-initiated mass credit
 * grants.
 *
 * One row per "Grant N credits to audience X" action from
 * `/admin/credits/broadcasts`. The actual per-user credit movement lives
 * in `credit_ledger` rows where `reason='broadcast_grant'` and
 * `metadata.broadcastId = <this row's id>`. We keep this table separate
 * so the admin "Broadcast history" view doesn't have to scan the ledger.
 *
 * `audience` mirrors the push-broadcast shape:
 *   - `{kind:'all'}`
 *   - `{kind:'entitlement', value:'free'|'pro'|'pro_max'}`
 *   - `{kind:'user_ids', ids:[...]}`
 */

import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export type CreditBroadcastAudience =
  | { kind: 'all' }
  | { kind: 'entitlement'; value: 'free' | 'pro' | 'pro_max' }
  | { kind: 'user_ids'; ids: string[] };

export const creditBroadcasts = pgTable(
  'credit_broadcasts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    initiatedByAdminId: uuid('initiated_by_admin_id')
      .references(() => users.id)
      .notNull(),
    audience: jsonb('audience').$type<CreditBroadcastAudience>().notNull(),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),

    pushTitle: text('push_title'),
    pushBody: text('push_body'),

    recipientCount: integer('recipient_count').default(0).notNull(),
    grantedCount: integer('granted_count').default(0).notNull(),

    sentAt: timestamp('sent_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [index('credit_broadcasts_sent_at_idx').on(t.sentAt)],
);

export type CreditBroadcast = typeof creditBroadcasts.$inferSelect;
export type NewCreditBroadcast = typeof creditBroadcasts.$inferInsert;
