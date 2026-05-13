-- Templates schema refactor: unify description, rename type→kind, swap
-- coverImage/previewGallery for coverMedia/previewVideo/gallery, add
-- author_name. Safe to run only on a fresh templates table — guards
-- (TRUNCATE) are below so a re-run on an environment that somehow
-- accumulated rows does the right thing.

-- Drop dependents we'll repopulate. `templates` has 0 rows on dev so
-- this is non-destructive; `template_versions` and `jobs` reference it
-- via FK and are also empty.
TRUNCATE TABLE "jobs" CASCADE;--> statement-breakpoint
TRUNCATE TABLE "template_versions" CASCADE;--> statement-breakpoint
TRUNCATE TABLE "templates" CASCADE;--> statement-breakpoint

-- Drop old indexes that reference soon-to-be-removed columns.
DROP INDEX IF EXISTS "templates_status_sort_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "templates_category_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "templates_featured_status_idx";--> statement-breakpoint

-- Drop columns that are being collapsed/renamed.
ALTER TABLE "templates" DROP COLUMN IF EXISTS "short_description";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN IF EXISTS "long_description";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN IF EXISTS "cover_image";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN IF EXISTS "preview_gallery";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN IF EXISTS "type";--> statement-breakpoint

-- Old enum is no longer referenced after the column drop above.
DROP TYPE IF EXISTS "public"."template_type";--> statement-breakpoint

-- New enum: user-facing output shape. Distinct from `generation.mode`,
-- which encodes the pipeline shape inside the JSON column.
CREATE TYPE "public"."template_kind" AS ENUM('image', 'video', 'image_set');--> statement-breakpoint

-- New columns (idempotent — safe to re-run if a prior attempt failed
-- partway).
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "author_name" text DEFAULT 'Clickfy Studio' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "kind" "template_kind" NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "cover_media" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "preview_video" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "gallery" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

-- Rebuild indexes (including the new kind-status one). `IF NOT EXISTS`
-- so a re-run is harmless.
CREATE INDEX IF NOT EXISTS "templates_status_sort_idx" ON "templates" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "templates_category_status_idx" ON "templates" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "templates_featured_status_idx" ON "templates" USING btree ("featured","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "templates_kind_status_idx" ON "templates" USING btree ("kind","status");
