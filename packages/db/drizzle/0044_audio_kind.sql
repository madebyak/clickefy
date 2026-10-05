-- Audio as an output kind (Phase 2, feature 3, day 6).
--
-- WHY
--   Generated speech, sound effects and converted voices are filed like
--   any other output: a `project_assets` row for the studio and, when a
--   user uploads audio, a `library_assets` row. Both tables held the kind
--   as text with an image|video check (library) or no check at all
--   (project_assets). The check learns `audio`; project_assets gets the
--   same check so a typo can never file an unknown kind.
--
-- SAFETY
--   Constraint changes only; every existing row is image or video and
--   passes. DROP IF EXISTS + ADD → re-runnable.

ALTER TABLE "library_assets" DROP CONSTRAINT IF EXISTS "library_assets_kind_check";
--> statement-breakpoint
ALTER TABLE "library_assets" ADD CONSTRAINT "library_assets_kind_check" CHECK ("kind" IN ('image', 'video', 'audio'));
--> statement-breakpoint
ALTER TABLE "project_assets" DROP CONSTRAINT IF EXISTS "project_assets_kind_check";
--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_kind_check" CHECK ("kind" IN ('image', 'video', 'audio'));
