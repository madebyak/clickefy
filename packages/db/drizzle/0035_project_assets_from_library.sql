-- Let a project asset come from "My Assets" rather than from a generation.
--
-- WHY A COLUMN AND NOT JUST A NULL job_id
--   `project_assets.job_id` is already nullable — a user can delete a job
--   from their history and keep the filed asset (see the table's own
--   header). So "no job" ALREADY means "the generation is gone", and the
--   UI says exactly that: "Generation details are no longer available".
--
--   A file placed from the library has no job either, but it is not a lost
--   generation — it never had one. Overloading the same NULL would make
--   those two states indistinguishable, and the canvas needs to tell them
--   apart: one shows "details unavailable", the other shows a "My Assets"
--   badge and hides Re-use entirely, because there is no prompt behind it
--   to re-use.
--
--   So the marker is a real reference rather than a boolean. It costs the
--   same and answers more: where did this come from, and is that source
--   still around.
--
-- ON DELETE SET NULL, deliberately.
--   Deleting the library file must not delete the copy already placed in a
--   project. The project asset keeps its own `r2_key` — which is NOT NULL
--   and is the source of truth for bytes — so it stays renderable; it just
--   stops pointing back at a source that no longer exists. That degrades to
--   the same state as a deleted job, which the UI already handles.
--
-- STORAGE: placing a library file into a project shares its `r2_key`
--   rather than duplicating the object, exactly as `copyAssets` already
--   does between projects. No bytes are copied and the quota is unmoved.
--   The consequence is handled in the API: the library delete now refuses
--   to remove an R2 object that a project asset still references.
--
-- SAFETY
--   - One nullable column on one table. No existing row is rewritten.
--   - No credit column is touched. Balances cannot move.
--   - Idempotent: IF NOT EXISTS.

ALTER TABLE "project_assets"
  ADD COLUMN IF NOT EXISTS "library_asset_id" uuid;
--> statement-breakpoint

ALTER TABLE "project_assets"
  DROP CONSTRAINT IF EXISTS "project_assets_library_asset_fk";
--> statement-breakpoint

ALTER TABLE "project_assets"
  ADD CONSTRAINT "project_assets_library_asset_fk"
  FOREIGN KEY ("library_asset_id")
  REFERENCES "library_assets"("id")
  ON DELETE SET NULL;
--> statement-breakpoint

-- Answers "is this R2 object still needed by a project?", which is the
-- question the library delete has to ask before removing an object.
CREATE INDEX IF NOT EXISTS "project_assets_library_asset_idx"
  ON "project_assets" ("library_asset_id")
  WHERE "library_asset_id" IS NOT NULL;
