/**
 * `favorite_assets` — a user's hearted generated outputs, surfaced as
 * one cross-project Favorites view in the web studio.
 *
 * Deliberately identical in shape to `saved_templates`: a pure join with
 * a composite primary key, so `ON CONFLICT DO NOTHING` makes favoriting
 * idempotent and an unfavorite of a row that isn't there is a no-op
 * rather than an error.
 *
 * Both FKs cascade:
 *   - user deleted ⇒ favorites go (nothing left to show them to);
 *   - asset row deleted ⇒ the favorite goes with it. Note this includes
 *     deleting the containing PROJECT, whose `project_assets` rows
 *     cascade — losing the favorite there is intended, since the asset
 *     itself is gone from the studio.
 *
 * MOVING an asset between projects preserves its id (see the in-place
 * UPDATE in `PATCH /v1/assets`), so a move keeps the favorite. That is
 * load-bearing: the previous copy-then-delete implementation minted a
 * fresh id and would have silently dropped every favorite on the moved
 * assets.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { projectAssets } from './project-assets';
import { users } from './users';

export const favoriteAssets = pgTable(
  'favorite_assets',
  {
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    assetId: uuid('asset_id')
      .references(() => projectAssets.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.assetId] }),
    userCreatedIdx: index('favorite_assets_user_created_idx').on(
      t.userId,
      t.createdAt.desc(),
    ),
  }),
);

export type FavoriteAsset = typeof favoriteAssets.$inferSelect;
export type NewFavoriteAsset = typeof favoriteAssets.$inferInsert;
