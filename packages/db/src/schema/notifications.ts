/**
 * In-app notification inbox.
 *
 * One row per user-facing notification (generation finished, generation
 * failed, system announcement). Written at the same chokepoint that sends
 * the push (`POST /v1/internal/push/user`) so the inbox mirrors what the
 * user received on their lockscreen — but persists even when the user has
 * no active push tokens (push disabled, permissions denied).
 *
 * Retention: capped at the latest ~30 rows per user, pruned on insert.
 * Notifications are ephemeral by nature; an unbounded inbox is neither
 * useful nor cheap. Deleted on account delete via the users FK cascade.
 *
 * `data` carries the deep-link payload (e.g. `{ type:'job_completed',
 * jobId }`) so tapping a row routes exactly like tapping the push.
 */

import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Notification kind — drives the icon + deep-link on the client. */
    type: text('type').$type<'job_completed' | 'job_failed' | 'system'>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Deep-link payload, mirrors the push `data` (e.g. `{ jobId }`). */
    data: jsonb('data').$type<Record<string, unknown>>(),
    /** Null = unread. Set to now() when the user reads it. */
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    // List + unread-count queries: "this user's notifications, newest first".
    index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
