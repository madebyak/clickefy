-- Label every generation and project by how it was born.
--
-- WHY
--   The Projects list needs to say what a project IS: something the user
--   composed in Create, a template they ran, or a tool they used. Until
--   now the only provenance was `jobs.source` (template vs user), which
--   cannot tell a tool run from a create run — a tool run is a user job
--   whose `options.tool` / `options.upscale` or tool-only model says so.
--   That judgement moves to a stored column, decided once at insert, so
--   no reader has to re-derive it.
--
--     jobs.origin                create | template | tool
--     projects.origin            the origin of the project's FIRST job
--     projects.origin_template_id  that job's template, for template-born
--                                projects (drives "open as a template run")
--
-- EXISTING ROWS — the one-time labelling below is the only write to
--   existing data in this migration, and it only fills the NEW columns:
--     jobs      source='template' → template; a user job with a tool /
--               upscale descriptor or the upscaler model → tool; else
--               create. Same rule the API applies at insert from now on.
--     projects  the origin (and template) of the earliest job filed
--               into them; projects with no jobs yet → create.
--   Every existing column keeps its value. No credit column is touched.
--
-- SAFETY
--   - Columns are added nullable, filled, then given DEFAULT + NOT NULL,
--     so the fill can never race an insert into a NOT NULL column.
--   - Every UPDATE is guarded by `origin IS NULL` → re-runnable.
--   - `IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` throughout.
--   - No FK on origin_template_id: templates are archived, never deleted.

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "origin" text;
--> statement-breakpoint

UPDATE "jobs"
SET "origin" = CASE
  WHEN "source" = 'template' THEN 'template'
  WHEN ("options" ? 'tool')
    OR ("options" ? 'upscale')
    OR "model_key" = 'bytedance-upscaler' THEN 'tool'
  ELSE 'create'
END
WHERE "origin" IS NULL;
--> statement-breakpoint

ALTER TABLE "jobs"
  ALTER COLUMN "origin" SET DEFAULT 'create';
--> statement-breakpoint

ALTER TABLE "jobs"
  ALTER COLUMN "origin" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "jobs"
  DROP CONSTRAINT IF EXISTS "jobs_origin_check";
--> statement-breakpoint

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_origin_check"
  CHECK ("origin" IN ('create', 'template', 'tool'));
--> statement-breakpoint

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "origin" text;
--> statement-breakpoint

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "origin_template_id" uuid;
--> statement-breakpoint

-- Projects with jobs: born from their earliest job.
UPDATE "projects" p
SET "origin" = first."origin",
    "origin_template_id" = CASE WHEN first."origin" = 'template' THEN first."template_id" END
FROM (
  SELECT DISTINCT ON ("project_id") "project_id", "origin", "template_id"
  FROM "jobs"
  WHERE "project_id" IS NOT NULL
  ORDER BY "project_id", "created_at" ASC, "id" ASC
) first
WHERE first."project_id" = p."id"
  AND p."origin" IS NULL;
--> statement-breakpoint

-- Projects with no jobs yet (created, nothing generated): composer-born.
UPDATE "projects"
SET "origin" = 'create'
WHERE "origin" IS NULL;
--> statement-breakpoint

ALTER TABLE "projects"
  ALTER COLUMN "origin" SET DEFAULT 'create';
--> statement-breakpoint

ALTER TABLE "projects"
  ALTER COLUMN "origin" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "projects"
  DROP CONSTRAINT IF EXISTS "projects_origin_check";
--> statement-breakpoint

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_origin_check"
  CHECK ("origin" IN ('create', 'template', 'tool'));
