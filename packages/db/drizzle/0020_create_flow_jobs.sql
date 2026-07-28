-- 0020_create_flow_jobs.sql
--
-- Enable the prompt-first "create from scratch" flow on the `jobs` table.
-- A create job (source='user') has NO template, so we:
--   1. relax the two template FKs to nullable (template jobs still set them);
--   2. add `source` — provenance discriminator, defaults 'template' so every
--      existing row is backfilled to the correct value automatically;
--   3. add `model_key` + `cost_credits` — set only for source='user' jobs
--      (the model the user picked and the flat per-model credit cost debited).
--
-- SAFETY / DATA IMPACT:
--   * NON-DESTRUCTIVE. No column is dropped, no data is deleted or rewritten.
--   * DROP NOT NULL is metadata-only (O(1), no table rewrite, no lock beyond a
--     brief ACCESS EXCLUSIVE for the catalog update). Existing rows are
--     untouched — they already hold template_id/template_version_id values.
--   * ADD COLUMN with a constant default is O(1) on modern Postgres (no rewrite).
--     The default backfills `source='template'` for all existing rows.
--   * Fully IDEMPOTENT — safe to run more than once. ADD COLUMN uses
--     IF NOT EXISTS; DROP NOT NULL on an already-nullable column is a no-op.
--
-- Everything runs in one implicit transaction (psql/Neon) so it's all-or-nothing.

ALTER TABLE "jobs" ALTER COLUMN "template_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "template_version_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'template' NOT NULL;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "model_key" text;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "cost_credits" integer;
