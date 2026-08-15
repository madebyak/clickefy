/**
 * `projects` — a user-named collection of generated assets (the web
 * studio's core organizing unit; the thing Higgsfield calls a
 * "project"). Assets live in `project_assets`, one row per generated
 * output, so moving/copying individual outputs between projects is a
 * row update — never JSON surgery inside `jobs.result`.
 *
 * Mobile is untouched by this table: mobile-created jobs keep
 * `jobs.project_id = NULL` and continue to surface through the flat
 * `GET /v1/jobs` history. Mobile can adopt projects later by reading
 * the same tables.
 *
 * `updatedAt` is bumped on rename / asset arrival so the sidebar's
 * "recent projects" ordering is a plain `ORDER BY updated_at DESC`.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { folders } from './folders';
import { users } from './users';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    // Folder deleted ⇒ project survives, unfiled.
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    /**
     * Pinned cover asset. Null (the default) means "derive from the
     * newest asset", which is how every project behaved before this
     * existed.
     *
     * The foreign key (REFERENCES project_assets(id) ON DELETE SET NULL)
     * is declared in migration 0027 and enforced by the database, but is
     * deliberately NOT declared here: `project_assets` already imports
     * this table, so pointing back at it forms an import cycle that
     * silently degrades Drizzle's inferred row types to `any` across
     * every query in the app. Nothing at the type level needs the
     * relation — only the column.
     */
    coverAssetId: uuid('cover_asset_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    // Matches the list query: `ORDER BY updated_at DESC, id DESC`
    // scoped to the owner (same compound-DESC pattern as jobs).
    index('projects_user_pagination_idx').on(t.userId, t.updatedAt.desc(), t.id.desc()),
    index('projects_folder_idx').on(t.folderId),
    index('projects_cover_asset_idx').on(t.coverAssetId),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
