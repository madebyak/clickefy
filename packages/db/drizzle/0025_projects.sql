-- 0025_projects.sql
--
-- Projects layer for the web studio (Phase 1C): user-named collections
-- of generated assets, with flat folders and one row per output.
--   1. `folders`        — flat per-user grouping for projects;
--   2. `projects`       — the collection unit (folder optional);
--   3. `project_assets` — one row per generated output filed into a
--      project, materialized by the jobs-worker at completion;
--   4. `jobs.project_id` — where a create-job files its outputs. NULL
--      for all mobile-created jobs (mobile is untouched by this feature).
--
-- SAFETY / DATA IMPACT:
--   * NON-DESTRUCTIVE. Purely additive: three new empty tables and one
--     nullable column on `jobs`. No existing column is altered, no data
--     is rewritten. Mobile's read/write paths are byte-for-byte intact.
--   * ADD COLUMN nullable with no default is metadata-only (O(1), no
--     table rewrite; brief ACCESS EXCLUSIVE for the catalog update).
--   * FK semantics: folder deleted -> project unfiled (SET NULL);
--     project deleted -> asset rows cascade (R2 objects are NOT touched
--     — storage cleanup stays with the retention crons, as everywhere);
--     job deleted from history -> filed asset survives (SET NULL, the
--     credit_ledger precedent); user deleted -> everything cascades.
--   * Fully IDEMPOTENT — CREATE TABLE/INDEX and ADD COLUMN all guard
--     with IF NOT EXISTS; safe to run more than once.
--
-- Everything runs in one implicit transaction (psql/Neon) so it's
-- all-or-nothing.

CREATE TABLE IF NOT EXISTS "folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_user_created_idx"
  ON "folders" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "folder_id" uuid REFERENCES "folders"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_user_pagination_idx"
  ON "projects" ("user_id", "updated_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_folder_idx"
  ON "projects" ("folder_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "job_id" uuid REFERENCES "jobs"("id") ON DELETE SET NULL,
  "output_index" integer DEFAULT 0 NOT NULL,
  "kind" text NOT NULL,
  "r2_key" text NOT NULL,
  "width" integer,
  "height" integer,
  "duration_sec" real,
  "poster_r2_key" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_assets_job_output_uq"
  ON "project_assets" ("project_id", "job_id", "output_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_assets_project_pagination_idx"
  ON "project_assets" ("project_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_assets_user_idx"
  ON "project_assets" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_assets_job_idx"
  ON "project_assets" ("job_id");
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_project_idx"
  ON "jobs" ("project_id");
