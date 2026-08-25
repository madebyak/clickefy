/**
 * "My Assets" — the per-user media library (0034).
 *
 * Two tables: a three-level folder tree, and the files filed into it.
 *
 * THE DEPTH RULE IS THE DATABASE'S, not the API's. `asset_folders` carries
 * a composite foreign key from `(parent_id, parent_depth)` to `(id, depth)`
 * where `parent_depth` is generated as `depth - 1`. A folder can therefore
 * only ever point at a parent exactly one level shallower, which makes a
 * fourth level unrepresentable AND cycles impossible — a loop would need a
 * folder shallower than itself.
 *
 * Drizzle cannot express a generated column paired with a composite FK, so
 * both live in the migration and are documented here instead. Do not
 * "reconcile" this file against a drizzle-kit diff: it will want to drop
 * the constraint that makes the whole shape safe.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  numeric,
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
export type AssetFolderDepth = 0 | 1 | 2;

/** What a library file can be. Audio is deliberately absent — see 0034. */
export type LibraryAssetKind = 'image' | 'video';

export const assetFolders = pgTable(
  'asset_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => assetFolders.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    depth: smallint('depth').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => [
    unique('asset_folders_id_depth_uq').on(t.id, t.depth),
    index('asset_folders_user_idx').on(t.userId, t.depth, t.createdAt),
    index('asset_folders_parent_idx').on(t.parentId),
    check('asset_folders_depth_range', sql`${t.depth} >= 0 AND ${t.depth} <= 2`),
    // A folder is at the root if and only if it has no parent.
    check(
      'asset_folders_root_coherent',
      sql`(${t.parentId} IS NULL) = (${t.depth} = 0)`,
    ),
  ],
);

export const libraryAssets = pgTable(
  'library_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /**
     * NULL is the library root. Deleting a folder sets this to NULL rather
     * than deleting the file — losing a folder must never silently destroy
     * uploads.
     */
    folderId: uuid('folder_id').references(() => assetFolders.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    kind: text('kind').$type<LibraryAssetKind>().notNull(),
    /** `user-uploads/<userId>/<uuid>.<ext>`, same layout as any upload. */
    r2Key: text('r2_key').notNull(),
    mimeType: text('mime_type').notNull(),
    /** Drives the per-plan quota. bigint: a library is cumulative. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: numeric('duration_seconds', { precision: 10, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => [
    // One row per object: re-registering an upload conflicts rather than
    // quietly double-counting it against the quota.
    unique('library_assets_r2_key_uq').on(t.r2Key),
    index('library_assets_user_recent_idx').on(t.userId, t.createdAt),
    index('library_assets_folder_idx').on(t.folderId, t.createdAt),
    check('library_assets_kind_check', sql`${t.kind} IN ('image', 'video')`),
    check('library_assets_size_positive', sql`${t.sizeBytes} > 0`),
  ],
);
