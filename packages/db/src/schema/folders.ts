/**
 * `folders` — a user's single-level grouping for projects (the web
 * studio's sidebar sections). Deliberately flat: no parentId, no
 * nesting — mirrors the shipped web UI, and a hierarchy can be added
 * later without touching existing rows.
 *
 * Deleting a folder does NOT delete its projects: `projects.folder_id`
 * is `SET NULL`, so they fall back to the "unfiled" section.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [index('folders_user_created_idx').on(t.userId, t.createdAt.desc())],
);

export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
