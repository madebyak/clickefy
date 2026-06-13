/**
 * `categories` — the browse taxonomy for templates.
 *
 * Supports a single level of nesting (parent → children) via the
 * self-referencing `parentId` column. Two-level nesting is a deliberate
 * V1 cap; deeper hierarchies cause UX problems on mobile.
 */

import { sql } from 'drizzle-orm';
import { type AnyPgColumn, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { CategoryTranslations } from './json-types';

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),

    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'set null',
    }),
    iconUrl: text('icon_url'),
    sortOrder: integer('sort_order').default(0).notNull(),

    /**
     * Non-English `name` overrides keyed by locale, e.g.
     * `{"ar": {"name": "..."}}`. English `name` above is the fallback.
     * Nullable — untranslated categories observe NULL.
     */
    translations: jsonb('translations').$type<CategoryTranslations | null>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [index('categories_parent_sort_idx').on(t.parentId, t.sortOrder)],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
