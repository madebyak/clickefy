/**
 * `grant_policies` — admin-tunable rules for system-issued free credits.
 *
 * Today the system reads two well-known kinds:
 *
 *   - `welcome`               — granted once per user on `user.created`
 *                               from Clerk. `amount` only; period_* fields
 *                               are NULL.
 *   - `periodic_free_refresh` — granted on a schedule (default weekly) to
 *                               every user whose row matches `audience`.
 *                               `period_unit` is one of 'day'|'week'|'month';
 *                               the jobs-worker cron checks per-user last
 *                               refresh time so it's idempotent within a
 *                               period.
 *
 * Adding a new kind = add a string here + wire the consumer; no migration
 * needed.
 *
 * `audience` is a JSON predicate the consumer evaluates server-side. The
 * default shape `{"entitlement":"free"}` selects free-tier users only.
 * Future shapes (`{"clientIds":[...]}`, `{"locale":"ar"}`) can be added
 * by extending the consumer logic without a schema change.
 */

import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export interface GrantPolicyAudience {
  entitlement?: 'free' | 'pro' | 'pro_max';
  // Future extensions live here without a migration.
}

export const grantPolicies = pgTable('grant_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull().unique(),
  isActive: boolean('is_active').default(true).notNull(),
  amount: integer('amount').notNull(),

  periodUnit: text('period_unit'),
  periodCount: integer('period_count').default(1),

  audience: jsonb('audience').$type<GrantPolicyAudience>().default({ entitlement: 'free' }).notNull(),

  updatedAt: timestamp('updated_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedByAdminId: uuid('updated_by_admin_id').references(() => users.id, {
    onDelete: 'set null',
  }),
});

export type GrantPolicy = typeof grantPolicies.$inferSelect;
export type NewGrantPolicy = typeof grantPolicies.$inferInsert;

export type GrantPolicyKind = 'welcome' | 'periodic_free_refresh';
