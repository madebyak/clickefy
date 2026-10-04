-- Admin smoke test for models.
--
-- WHY
--   A model added from the admin panel (fal rows, Phase 2) must prove it
--   runs before it is offered. The admin button submits one real job on
--   the admin's own account; these columns remember which job and how it
--   ended, so the Models page can show "tested 2 h ago · ok".
--
--     provider_models.last_test_job_id   the job
--     provider_models.last_tested_at     when it was submitted
--     provider_models.last_test_ok       null = pending, true/false = outcome
--
-- SAFETY
--   - Nullable columns, IF NOT EXISTS → re-runnable; no backfill.
--   - No FK on last_test_job_id: jobs are purged on retention.

ALTER TABLE "provider_models"
  ADD COLUMN IF NOT EXISTS "last_test_job_id" uuid;
--> statement-breakpoint

ALTER TABLE "provider_models"
  ADD COLUMN IF NOT EXISTS "last_tested_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "provider_models"
  ADD COLUMN IF NOT EXISTS "last_test_ok" boolean;
