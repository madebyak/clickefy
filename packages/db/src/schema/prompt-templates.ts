/**
 * Hidden prompts an admin may edit without a deploy. One row per key
 * holds the current text; every save also lands in the versions table
 * so any earlier text can be restored. A missing row means the code
 * default applies (see `@clickfy/providers` for each key's default).
 *
 * Keys today: `ad_brief` — the director brief behind the One-Click Ad.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const promptTemplates = pgTable('prompt_templates', {
  key: text('key').primaryKey(),
  body: text('body').notNull(),
  updatedByAdminId: uuid('updated_by_admin_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`).notNull(),
});

export const promptTemplateVersions = pgTable(
  'prompt_template_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    body: text('body').notNull(),
    note: text('note'),
    createdByAdminId: uuid('created_by_admin_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => [index('prompt_template_versions_key_idx').on(t.key, t.createdAt)],
);

export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type PromptTemplateVersion = typeof promptTemplateVersions.$inferSelect;
