-- Add an optional free-form note to credit_ledger rows so admin
-- adjustments can carry context (e.g. "goodwill credit for failed
-- generation on 2026-05-13"). All existing rows backfill to NULL.

ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "note" text;
