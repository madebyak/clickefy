-- "My Assets" — a durable, per-user media library.
--
-- WHAT THIS IS FOR
--   Today every upload is transient: you attach a reference, generate, and
--   the file is never listed anywhere again. A brand logo used in forty
--   generations is uploaded forty times. This gives uploads a home you can
--   organise, search and re-use across projects.
--
-- WHY NOT REUSE `folders`
--   That table is the PROJECT filing tree: flat, no `parent_id`, and its
--   rows mean "a group of projects". This tree holds files and must nest.
--   Sharing one table would mean a folder that is sometimes a project
--   container and sometimes a media folder, distinguished by which column
--   happens to be null.
--
-- THE THREE-LEVEL LIMIT IS ENFORCED BY THE DATABASE, not by the API.
--   `depth` is stored, and a composite foreign key ties every folder to a
--   parent exactly one level shallower:
--
--       UNIQUE (id, depth)
--       FOREIGN KEY (parent_id, parent_depth) → (id, depth)
--
--   where `parent_depth` is a generated column equal to `depth - 1`. A
--   folder at depth 1 can therefore ONLY point at a folder at depth 0, and
--   the CHECK caps depth at 2. Three consequences fall out for free:
--
--     1. No fourth level is expressible, however the API is called.
--     2. CYCLES ARE IMPOSSIBLE. A parent is always strictly shallower, so
--        a loop would require a folder shallower than itself. This is the
--        real prize — cycle prevention in an adjacency list normally means
--        a recursive check on every move, which is easy to forget and
--        expensive to run.
--     3. A root folder has `parent_id IS NULL`, and a composite FK with a
--        NULL column is not enforced (MATCH SIMPLE), so depth 0 is exempt
--        without needing a special case.
--
-- SAFETY
--   - Purely additive: two new tables, no existing table altered.
--   - No credit column is touched. Balances cannot move.
--   - Deleting a folder CASCADES to sub-folders but sets its files'
--     `folder_id` to NULL rather than deleting them: losing a folder
--     should never silently destroy uploads. They reappear at the root.

CREATE TABLE IF NOT EXISTS "asset_folders" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"   uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "parent_id" uuid REFERENCES "asset_folders"("id") ON DELETE CASCADE,
  "name"      text NOT NULL,
  -- 0 = top level, 1 = sub-folder, 2 = sub-sub-folder. No deeper.
  "depth"     smallint NOT NULL DEFAULT 0,
  -- Exists solely as the second half of the composite FK below.
  "parent_depth" smallint GENERATED ALWAYS AS ("depth" - 1) STORED,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "asset_folders_depth_range" CHECK ("depth" >= 0 AND "depth" <= 2),
  -- A folder is at the root if and only if it has no parent. Without this
  -- a row could claim depth 2 with no parent, or depth 0 with one.
  CONSTRAINT "asset_folders_root_coherent"
    CHECK (("parent_id" IS NULL) = ("depth" = 0))
);
--> statement-breakpoint
-- The target of the composite FK. Redundant with the primary key on its
-- own, but a composite FK needs a matching unique constraint.
ALTER TABLE "asset_folders"
  DROP CONSTRAINT IF EXISTS "asset_folders_id_depth_uq";
--> statement-breakpoint
ALTER TABLE "asset_folders"
  ADD CONSTRAINT "asset_folders_id_depth_uq" UNIQUE ("id", "depth");
--> statement-breakpoint
-- The line that makes a fourth level, and every cycle, unrepresentable.
ALTER TABLE "asset_folders"
  DROP CONSTRAINT IF EXISTS "asset_folders_parent_one_level_up";
--> statement-breakpoint
ALTER TABLE "asset_folders"
  ADD CONSTRAINT "asset_folders_parent_one_level_up"
  FOREIGN KEY ("parent_id", "parent_depth")
  REFERENCES "asset_folders"("id", "depth")
  ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_folders_user_idx"
  ON "asset_folders" ("user_id", "depth", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_folders_parent_idx"
  ON "asset_folders" ("parent_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "library_assets" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"   uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- NULL means the library root. Folders are optional; a file dropped in
  -- without filing it is still a usable file.
  "folder_id" uuid REFERENCES "asset_folders"("id") ON DELETE SET NULL,
  "name"      text NOT NULL,
  -- 'image' | 'video'. Audio is deliberately absent: nothing in the model
  -- catalogue can consume an audio reference yet, and a library that
  -- stores what it cannot use invites the question why.
  "kind"      text NOT NULL,
  -- The R2 object. Uploaded through the existing user-upload path, so the
  -- key layout is `user-uploads/<userId>/<uuid>.<ext>` exactly as before.
  "r2_key"    text NOT NULL,
  "mime_type" text NOT NULL,
  -- Drives the per-plan storage quota. bigint because a library is
  -- cumulative and integer tops out at 2GB.
  "size_bytes" bigint NOT NULL,
  "width"      integer,
  "height"     integer,
  "duration_seconds" numeric(10, 2),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_assets_kind_check" CHECK ("kind" IN ('image', 'video')),
  CONSTRAINT "library_assets_size_positive" CHECK ("size_bytes" > 0)
);
--> statement-breakpoint
-- One row per object. Re-registering the same upload is a conflict rather
-- than a second row quietly double-counting against the quota.
CREATE UNIQUE INDEX IF NOT EXISTS "library_assets_r2_key_uq"
  ON "library_assets" ("r2_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_assets_user_recent_idx"
  ON "library_assets" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_assets_folder_idx"
  ON "library_assets" ("folder_id", "created_at" DESC);
