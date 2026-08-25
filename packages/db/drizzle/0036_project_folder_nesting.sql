-- Let project folders nest, three levels deep.
--
-- `folders` has been flat since it was created: a single level of grouping
-- for projects, with the sidebar tree built to match. The header on
-- `folders.ts` said a hierarchy could be added later without touching
-- existing rows — this is that, and it holds: every existing folder is a
-- root folder, which is exactly what depth 0 with a NULL parent means.
--
-- THE SAME ENFORCEMENT `asset_folders` USES (migration 0034), and for the
-- same reasons. `depth` is stored, and a composite foreign key ties every
-- folder to a parent exactly one level shallower:
--
--     UNIQUE (id, depth)
--     FOREIGN KEY (parent_id, parent_depth) → (id, depth)
--
-- where `parent_depth` is generated as `depth - 1`. A folder at depth 1
-- can therefore ONLY point at a folder at depth 0, and the CHECK caps
-- depth at 2. Two things fall out for free:
--
--   1. A fourth level is unrepresentable, however the API is called.
--   2. CYCLES ARE IMPOSSIBLE — a parent is always strictly shallower, so
--      a loop would need a folder shallower than itself. No recursive
--      check on every move, nothing to forget.
--
-- WHY MIRROR RATHER THAN SHARE `asset_folders`. These two trees hold
-- different things: one groups projects, the other holds files. Merging
-- them would mean a folder that is sometimes a project container and
-- sometimes a media folder, told apart by which column happens to be
-- null. The duplicated constraint block is the cheaper of the two costs.
--
-- SAFETY
--   - Additive only. Three columns, all with defaults that describe what
--     every existing row already is: a root folder at depth 0.
--   - No credit column is touched. Balances cannot move.
--   - `projects.folder_id` is untouched and stays ON DELETE SET NULL, so
--     deleting a folder still leaves its projects unfiled rather than
--     destroying them. Sub-folders CASCADE, matching the asset library.
--   - Idempotent: every statement is IF NOT EXISTS / DROP-then-ADD.

ALTER TABLE "folders"
  ADD COLUMN IF NOT EXISTS "parent_id" uuid;
--> statement-breakpoint

-- 0 = top level, 1 = sub-folder, 2 = sub-sub-folder. Existing rows take
-- the default and become exactly what they already were.
ALTER TABLE "folders"
  ADD COLUMN IF NOT EXISTS "depth" smallint NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Exists solely as the second half of the composite FK below.
ALTER TABLE "folders"
  ADD COLUMN IF NOT EXISTS "parent_depth" smallint GENERATED ALWAYS AS ("depth" - 1) STORED;
--> statement-breakpoint

ALTER TABLE "folders"
  DROP CONSTRAINT IF EXISTS "folders_depth_range";
--> statement-breakpoint
ALTER TABLE "folders"
  ADD CONSTRAINT "folders_depth_range" CHECK ("depth" >= 0 AND "depth" <= 2);
--> statement-breakpoint

-- A folder is at the root if and only if it has no parent. Without this a
-- row could claim depth 2 with no parent, or depth 0 with one.
ALTER TABLE "folders"
  DROP CONSTRAINT IF EXISTS "folders_root_coherent";
--> statement-breakpoint
ALTER TABLE "folders"
  ADD CONSTRAINT "folders_root_coherent"
  CHECK (("parent_id" IS NULL) = ("depth" = 0));
--> statement-breakpoint

-- The target of the composite FK. Redundant with the primary key on its
-- own, but a composite FK needs a matching unique constraint.
ALTER TABLE "folders"
  DROP CONSTRAINT IF EXISTS "folders_id_depth_uq";
--> statement-breakpoint
ALTER TABLE "folders"
  ADD CONSTRAINT "folders_id_depth_uq" UNIQUE ("id", "depth");
--> statement-breakpoint

-- Plain parent reference: deleting a folder takes its sub-folders with it.
ALTER TABLE "folders"
  DROP CONSTRAINT IF EXISTS "folders_parent_fk";
--> statement-breakpoint
ALTER TABLE "folders"
  ADD CONSTRAINT "folders_parent_fk"
  FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- The line that makes a fourth level, and every cycle, unrepresentable.
ALTER TABLE "folders"
  DROP CONSTRAINT IF EXISTS "folders_parent_one_level_up";
--> statement-breakpoint
ALTER TABLE "folders"
  ADD CONSTRAINT "folders_parent_one_level_up"
  FOREIGN KEY ("parent_id", "parent_depth")
  REFERENCES "folders"("id", "depth")
  ON DELETE CASCADE;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "folders_parent_idx"
  ON "folders" ("parent_id");
