/**
 * `folders` — a user's grouping for projects (the web studio's sidebar
 * tree). Three levels deep as of migration 0036; every folder created
 * before that is a root folder, which is what `depth 0, parent NULL`
 * already meant.
 *
 * THE DEPTH RULE IS THE DATABASE'S, not the API's. `depth` is stored and
 * a composite foreign key — `(parent_id, parent_depth) → (id, depth)`,
 * with `parent_depth` generated as `depth - 1` — makes a fourth level and
 * every cycle unrepresentable. See 0036 for the full reasoning; the short
 * version is that cycle prevention costs nothing at write time instead of
 * a recursive check on every move.
 *
 * `parent_depth` is a GENERATED column and is deliberately absent below.
 * Drizzle has no generated-column type that round-trips here, and nothing
 * in the app reads it — it exists only as the second half of that FK.
 * Do NOT "reconcile" this file against a drizzle-kit diff: it will offer
 * to drop the column and the constraints that depend on it.
 *
 * Deleting a folder does NOT delete its projects: `projects.folder_id`
 * is `SET NULL`, so they fall back to the "unfiled" section. Sub-folders
 * DO cascade, matching the asset library.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { users } from './users';

/** 0 = top level, 1 = sub-folder, 2 = sub-sub-folder. */
export type FolderDepth = 0 | 1 | 2;

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    depth: smallint('depth').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('folders_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('folders_parent_idx').on(t.parentId),
    unique('folders_id_depth_uq').on(t.id, t.depth),
    check('folders_depth_range', sql`${t.depth} >= 0 AND ${t.depth} <= 2`),
    // A folder is at the root if and only if it has no parent.
    check('folders_root_coherent', sql`(${t.parentId} IS NULL) = (${t.depth} = 0)`),
  ],
);

export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
