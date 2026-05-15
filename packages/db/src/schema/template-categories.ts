/**
 * `template_categories` — many-to-many between templates and categories.
 *
 * A template can live in 1..3 categories. Exactly one of those rows
 * is marked `is_primary = true` — the primary drives breadcrumbs,
 * single-category labels, analytics roll-ups, and the cross-rail
 * dedup rule on the home feed ("show in primary's rail only").
 *
 * Invariants:
 *   - At most one primary per template (enforced by a partial unique
 *     index on `(template_id) WHERE is_primary`).
 *   - At least one primary per template — application-enforced: every
 *     write path that touches this table verifies the result set has
 *     exactly one `is_primary = true` row before committing.
 *   - `(template_id, category_id)` is unique (composite PK) so the
 *     same template cannot appear twice in the same category.
 *
 * Cascade behaviour:
 *   - `ON DELETE CASCADE` for templates — deleting a template wipes
 *     its membership rows.
 *   - `ON DELETE RESTRICT` for categories — a category that's
 *     referenced anywhere refuses to be deleted, surfaced to the
 *     admin as a 409 with "used by N templates". Same protection
 *     the old single-FK had.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { categories } from './categories';
import { templates } from './templates';

export const templateCategories = pgTable(
  'template_categories',
  {
    templateId: uuid('template_id')
      .references(() => templates.id, { onDelete: 'cascade' })
      .notNull(),
    categoryId: uuid('category_id')
      .references(() => categories.id, { onDelete: 'restrict' })
      .notNull(),

    /**
     * Exactly one row per template has this set. The partial unique
     * index below makes "two primaries" impossible; the "zero
     * primaries" case is the responsibility of the API write path.
     */
    isPrimary: boolean('is_primary').default(false).notNull(),

    /**
     * Display order *within* the secondary set. Not used to override
     * `is_primary` — that's always rendered first. Defaults to 0
     * because the first-added extra sorts before the second.
     */
    sortOrder: integer('sort_order').default(0).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.templateId, t.categoryId] }),
    // Postgres partial unique index — enforces at-most-one primary
    // per template at the DB level. Drizzle's `.where()` on a unique
    // index emits exactly the right `CREATE UNIQUE INDEX … WHERE`.
    uniqueIndex('template_categories_primary_uniq')
      .on(t.templateId)
      .where(sql`is_primary`),
    // Powers "templates in this category" lookups (catalog list,
    // section-builder rails). The composite key already has an index
    // on `(template_id, category_id)` from the PK; this complements
    // it for the inverse direction.
    index('template_categories_category_sort_idx').on(t.categoryId, t.sortOrder),
  ],
);

export type TemplateCategory = typeof templateCategories.$inferSelect;
export type NewTemplateCategory = typeof templateCategories.$inferInsert;
