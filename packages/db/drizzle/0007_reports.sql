-- reports — user-submitted content flags + enums.
-- Drives the admin moderation queue and satisfies App Store / Play
-- Store UGC policy: every shipped UGC app must expose a flag flow.

CREATE TYPE "report_reason" AS ENUM (
    'csam',
    'sexual_content',
    'violence_or_threats',
    'hate_speech',
    'harassment',
    'spam',
    'copyright',
    'other'
);
--> statement-breakpoint
CREATE TYPE "report_status" AS ENUM (
    'open',
    'reviewing',
    'resolved',
    'dismissed'
);
--> statement-breakpoint
CREATE TYPE "report_target_type" AS ENUM (
    'job_output',
    'template',
    'user'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "reporter_user_id" uuid,
    "target_type" "report_target_type" NOT NULL,
    "target_id" text NOT NULL,
    "reason" "report_reason" NOT NULL,
    "notes" text,
    "status" "report_status" DEFAULT 'open' NOT NULL,
    "admin_notes" text,
    "resolved_at" timestamp with time zone,
    "resolved_by_user_id" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports"
    ADD CONSTRAINT "reports_reporter_user_id_users_id_fk"
    FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "reports"
    ADD CONSTRAINT "reports_resolved_by_user_id_users_id_fk"
    FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_status_created_idx"
    ON "reports" ("status", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_target_idx"
    ON "reports" ("target_type", "target_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_reporter_idx"
    ON "reports" ("reporter_user_id", "created_at" DESC);
