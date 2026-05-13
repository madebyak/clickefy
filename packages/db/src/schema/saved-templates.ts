/**
 * `saved_templates` — user-curated bookmarks of templates.
 *
 * Pure many-to-many join: a user "saves" a template once, and the
 * row is created if absent or no-op'd if present. The composite
 * primary key `(user_id, template_id)` enforces uniqueness without
 * needing a separate constraint.
 *
 * Why a dedicated table (not a JSON column on `users`):
 *   - Listing "templates saved by N users" is a single index scan
 *     instead of unpacking JSON across the whole users table.
 *   - Per-row created_at lets us sort the Saved tab by recency.
 *   - Cascade delete keeps the table clean if a template is hard-
 *     deleted (which we don't do today, but the FK is free).
 *
 * Indexes:
 *   - PK on `(user_id, template_id)` powers the "is this saved?"
 *     lookup that fires on every template-detail open.
 *   - Secondary on `(user_id, created_at desc)` powers the Saved
 *     tab list ordering.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { templates } from './templates';
import { users } from './users';

export const savedTemplates = pgTable(
  'saved_templates',
  {
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    templateId: uuid('template_id')
      .references(() => templates.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.templateId] }),
    userCreatedIdx: index('saved_templates_user_created_idx').on(
      t.userId,
      t.createdAt.desc(),
    ),
  }),
);

export type SavedTemplate = typeof savedTemplates.$inferSelect;
export type NewSavedTemplate = typeof savedTemplates.$inferInsert;
