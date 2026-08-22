-- Global asset favorites.
--
-- A user "hearts" a generated output and it shows up in one cross-project
-- Favorites view in the studio sidebar. Same shape as `saved_templates`:
-- a pure many-to-many join with a composite primary key, which makes both
-- favorite and unfavorite idempotent at the SQL layer.
--
-- Why a table and not a boolean on `project_assets`:
--   - Favorites are per-USER, and an asset row is per-project. A boolean
--     would be wrong the moment sharing exists.
--   - `(user_id, created_at DESC)` gives the Favorites page its ordering
--     for free; a boolean column would need a partial index anyway.
--
-- SAFETY
--   - Purely additive: one new table, no column added to, dropped from,
--     or rewritten on any existing table. No backfill. Nothing to undo
--     beyond DROP TABLE.
--   - Both FKs CASCADE, so a deleted user or a deleted asset takes its
--     favorites with it — no orphan rows, no dangling references. The R2
--     object is untouched either way (the retention cron owns storage).

CREATE TABLE IF NOT EXISTS "favorite_assets" (
  "user_id"    uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "asset_id"   uuid NOT NULL REFERENCES "project_assets"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "favorite_assets_pk" PRIMARY KEY ("user_id", "asset_id")
);
--> statement-breakpoint
-- Powers the Favorites page: `WHERE user_id = $1 ORDER BY created_at DESC, asset_id DESC`.
CREATE INDEX IF NOT EXISTS "favorite_assets_user_created_idx"
  ON "favorite_assets" ("user_id", "created_at" DESC);
