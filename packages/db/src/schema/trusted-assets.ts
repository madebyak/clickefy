/**
 * `trusted_assets` — one row per uploaded file we have looked at for a
 * person, and (when there was one) its registration in BytePlus's private
 * asset library so Seedance accepts it.
 *
 * Lifecycle of `status`:
 *
 *   checking   → a Gemini vision model is deciding whether a person is shown
 *   no_human   → none; Seedance takes the file as is (terminal, cached)
 *   verifying  → registered with BytePlus, waiting for its review
 *   verified   → Active on BytePlus; `byteplus_asset_id` is usable
 *   failed     → BytePlus or the check refused it; `error` says why; retryable
 *   released   → the BytePlus asset was deleted to free its slot; the person
 *                verdict stays cached and a later job re-registers the file
 *
 * The library's capacity on the free tier is 50 assets in total with no
 * reset, so slots are held only while needed: a verified asset is released
 * after its job finishes, and the sweeper releases anything idle for half
 * an hour. `last_used_at` drives both.
 */

import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export type TrustedAssetStatus = 'checking' | 'no_human' | 'verifying' | 'verified' | 'failed' | 'released';

export const trustedAssets = pgTable(
  'trusted_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** The upload (`user-uploads/<user>/…`) or library file this row is about. */
    r2Key: text('r2_key').notNull().unique(),
    kind: text('kind').$type<'image' | 'video' | 'audio'>().notNull(),
    mimeType: text('mime_type'),
    /** sha-256 of the bytes — the same picture uploaded twice shares its verdict. */
    contentSha256: text('content_sha256'),
    status: text('status').$type<TrustedAssetStatus>().notNull().default('checking'),
    /** The vision model's verdict; null until it has answered. */
    human: boolean('human'),
    checkModel: text('check_model'),
    checkReason: text('check_reason'),
    byteplusGroupId: text('byteplus_group_id'),
    byteplusAssetId: text('byteplus_asset_id'),
    /** Why `failed`, for the user and for us. */
    error: text('error'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => [
    index('trusted_assets_user_idx').on(t.userId, t.createdAt),
    index('trusted_assets_status_idx').on(t.status, t.lastUsedAt),
    index('trusted_assets_sha_idx').on(t.contentSha256),
  ],
);

export type TrustedAsset = typeof trustedAssets.$inferSelect;
export type NewTrustedAsset = typeof trustedAssets.$inferInsert;
