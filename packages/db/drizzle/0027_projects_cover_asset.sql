-- Pinned project cover.
--
-- The project list currently derives its thumbnail with DISTINCT ON
-- (newest asset per project), so the cover changes every time the user
-- generates. This adds an OPTIONAL override: when set, the list uses it;
-- when null, the newest-asset behaviour is unchanged.
--
-- SAFETY
--   - Additive only: one nullable column, no default, no backfill, no
--     rewrite of existing rows. Every existing project keeps deriving
--     its cover exactly as before.
--   - ON DELETE SET NULL, so deleting the pinned asset silently reverts
--     that project to newest-asset rather than orphaning a reference or
--     cascading into the project itself.
--   - The partial index covers the reverse lookup performed when an
--     asset is deleted; it indexes only the rows that have a pin.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "cover_asset_id" uuid
  REFERENCES "project_assets"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "projects_cover_asset_idx"
  ON "projects" ("cover_asset_id")
  WHERE "cover_asset_id" IS NOT NULL;
