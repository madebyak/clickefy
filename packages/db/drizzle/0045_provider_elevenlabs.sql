-- ElevenLabs as a provider (Phase 2, feature 3, day 7).
--
-- WHY
--   `provider_models.provider` and `template` stages use the `provider`
--   enum. The Audio section's three models (speech, sound effects, voice
--   changer) are the first rows from ElevenLabs.
--
-- SAFETY
--   ADD VALUE IF NOT EXISTS → re-runnable; no rows touched. Postgres
--   cannot run it inside a transaction block, which is why the file holds
--   only this statement.

ALTER TYPE "provider" ADD VALUE IF NOT EXISTS 'elevenlabs';
