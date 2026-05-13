/**
 * `template_versions` — append-only history of every publish action.
 *
 * Why it matters: a user's job records `templateVersionId`. If an admin
 * later edits the prompt, the user's already-delivered result still
 * reflects the version that produced it. This makes refunds / dispute
 * resolution / regression debugging tractable.
 */

import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { templates } from './templates';
import { users } from './users';

export const templateVersions = pgTable(
  'template_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .references(() => templates.id, { onDelete: 'cascade' })
      .notNull(),
    versionNumber: integer('version_number').notNull(),

    /** Full row snapshot at publish time. We do not narrow it further
     * here — older versions may include columns/fields we've since
     * renamed; we want them preserved verbatim for audit. */
    snapshot: jsonb('snapshot').notNull(),

    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    publishNote: text('publish_note'),
  },
  (t) => [unique('template_versions_unique_per_template').on(t.templateId, t.versionNumber)],
);

export type TemplateVersion = typeof templateVersions.$inferSelect;
export type NewTemplateVersion = typeof templateVersions.$inferInsert;
