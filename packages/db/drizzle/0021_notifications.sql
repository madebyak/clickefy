-- 0021_notifications.sql
--
-- In-app notification inbox (generation finished/failed, system messages).
-- Written at the push chokepoint so the inbox mirrors lockscreen pushes but
-- survives even when the user has no active push tokens.
--
-- SAFETY: purely additive — a brand-new table + index. Touches no existing
-- table or data. Idempotent (IF NOT EXISTS). Cascade-deletes with the user.

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "data" jsonb,
  "read_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx"
  ON "notifications" ("user_id", "created_at" DESC);
