-- admin_audit_log — one row per successful admin-side mutation.
-- Populated by `withAdmin()` middleware via c.executionCtx.waitUntil(),
-- so writes are fire-and-forget and never block the response.

CREATE TABLE IF NOT EXISTS "admin_audit_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "admin_user_id" uuid,
    "method" text NOT NULL,
    "path" text NOT NULL,
    "resource_id" text,
    "metadata" jsonb,
    "ip" text,
    "user_agent" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_admin_user_id_users_id_fk"
    FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_admin_idx"
    ON "admin_audit_log" ("admin_user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_path_idx"
    ON "admin_audit_log" ("path", "created_at" DESC);
