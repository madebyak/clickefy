-- User preferences: add a single JSONB column for everything we want to
-- persist per-user beyond identity + entitlement (appearance, notification
-- toggles, …). Defaulted so existing rows pick up sensible values without
-- a backfill.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferences" jsonb NOT NULL DEFAULT '{"appearance":{"mode":"system","accent":"violet"},"notifications":{"jobCompleted":true,"productUpdates":true,"tipsAndTutorials":true}}'::jsonb;
