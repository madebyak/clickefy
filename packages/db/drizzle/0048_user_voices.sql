-- User-owned voices (Audio section, ElevenLabs Creator plan, 2026-10-17).
--
-- WHY
--   Users can now clone a voice from a recording or design one from a
--   description. Every such voice lives on the client's single ElevenLabs
--   account (30 custom slots on Creator), so this table is what makes a
--   voice private to the user who made it, and what the per-user cap and
--   the account-wide guard count. Making a voice costs credits, recorded
--   in the ledger with the new reason `voice_charge` (no job behind it;
--   the enum value is 0049, since ADD VALUE cannot share a transaction).
--
-- SAFETY
--   New table only; IF NOT EXISTS → re-runnable.

CREATE TABLE IF NOT EXISTS "user_voices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "elevenlabs_voice_id" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "description" text,
  "origin" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ready',
  "labels" jsonb,
  "credits_charged" text,
  "consent_at" timestamp with time zone,
  "consent_version" text,
  "last_used_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_voices_origin_check" CHECK ("origin" IN ('cloned', 'designed')),
  CONSTRAINT "user_voices_status_check" CHECK ("status" IN ('ready', 'pending_verification', 'deleted'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_voices_user_idx" ON "user_voices" ("user_id", "status", "created_at");
