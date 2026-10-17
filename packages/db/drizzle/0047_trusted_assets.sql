-- Trusted assets (Phase 2 feature 5, 2026-10-17).
--
-- WHY
--   Seedance rejects reference images and clips that show a human face.
--   BytePlus's private asset library accepts AI-generated people once a
--   file is registered there, and the generation then names
--   `asset://<id>`. This table records, per uploaded file, whether a
--   vision model saw a person and the file's registration in that
--   library, so a slot (50 in total on the free tier) is held only while
--   a job needs it. See packages/db/src/schema/trusted-assets.ts.
--
-- SAFETY
--   New table only; IF NOT EXISTS → re-runnable.

CREATE TABLE IF NOT EXISTS "trusted_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "r2_key" text NOT NULL UNIQUE,
  "kind" text NOT NULL,
  "mime_type" text,
  "content_sha256" text,
  "status" text NOT NULL DEFAULT 'checking',
  "human" boolean,
  "check_model" text,
  "check_reason" text,
  "byteplus_group_id" text,
  "byteplus_asset_id" text,
  "error" text,
  "verified_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "released_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "trusted_assets_kind_check" CHECK ("kind" IN ('image', 'video', 'audio')),
  CONSTRAINT "trusted_assets_status_check" CHECK ("status" IN ('checking', 'no_human', 'verifying', 'verified', 'failed', 'released'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "trusted_assets_user_idx" ON "trusted_assets" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trusted_assets_status_idx" ON "trusted_assets" ("status", "last_used_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trusted_assets_sha_idx" ON "trusted_assets" ("content_sha256");
