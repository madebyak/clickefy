-- device_tokens — Expo push notification registry.
-- See packages/db/src/schema/device-tokens.ts for rationale.

CREATE TABLE IF NOT EXISTS "device_tokens" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "expo_push_token" text NOT NULL UNIQUE,
    "platform" text NOT NULL,
    "app_version" text,
    "locale" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_tokens"
    ADD CONSTRAINT "device_tokens_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_tokens_user_active_idx"
    ON "device_tokens" ("user_id", "is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_tokens_active_idx"
    ON "device_tokens" ("is_active", "platform");
