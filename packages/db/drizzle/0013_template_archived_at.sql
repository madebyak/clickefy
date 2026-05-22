-- 0013_template_archived_at.sql
--
-- Add `archived_at` to `templates` to track when a template was
-- soft-archived. The `status = 'archived'` enum value already exists
-- (since 0000) and is the authoritative state flag — this column is
-- purely "when did it happen?", used for sorting the admin Archived
-- view by recency and as the input to a future auto-purge job.
--
-- Backfill: for any rows that are already in `archived` status (none
-- in production yet, but the migration is idempotent), set
-- `archived_at = updated_at` so the view sorts sensibly.
--
-- Zero index churn — Postgres adds a nullable timestamp column in O(1)
-- on modern versions (no full-table rewrite).

ALTER TABLE "templates"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;
--> statement-breakpoint
UPDATE "templates"
SET "archived_at" = "updated_at"
WHERE "status" = 'archived' AND "archived_at" IS NULL;
