-- revenuecat_events — audit log of webhook deliveries from RevenueCat.
-- See packages/db/src/schema/revenuecat-events.ts for rationale.

CREATE TABLE IF NOT EXISTS "revenuecat_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" text NOT NULL UNIQUE,
    "event_type" text NOT NULL,
    "app_user_id" text NOT NULL,
    "user_id" uuid,
    "product_id" text,
    "entitlement_id" text,
    "payload" jsonb NOT NULL,
    "processed_at" timestamp with time zone,
    "processing_error" text,
    "event_occurred_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "revenuecat_events"
    ADD CONSTRAINT "revenuecat_events_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rc_events_unprocessed_idx"
    ON "revenuecat_events" ("processed_at", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rc_events_user_idx"
    ON "revenuecat_events" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rc_events_app_user_idx"
    ON "revenuecat_events" ("app_user_id", "created_at" DESC);
