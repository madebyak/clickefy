-- Editable hidden prompts (Phase 2, One-Click Ad follow-up, 2026-10-08).
--
-- WHY
--   The director brief that writes an ad lived only in code. The client
--   will tune it as results come in, without a deploy, so the current
--   text sits in `prompt_templates` (one row per key) and every save is
--   kept in `prompt_template_versions` so a bad edit can be restored.
--   No row means "use the code default".
--
-- SAFETY
--   New tables only; IF NOT EXISTS → re-runnable.

CREATE TABLE IF NOT EXISTS "prompt_templates" (
  "key" text PRIMARY KEY,
  "body" text NOT NULL,
  "updated_by_admin_id" uuid,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prompt_template_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL,
  "body" text NOT NULL,
  "note" text,
  "created_by_admin_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prompt_template_versions_key_idx" ON "prompt_template_versions" ("key", "created_at");
