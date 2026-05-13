-- saved_templates — many-to-many between users and templates.
-- Composite PK enforces uniqueness; secondary index powers the
-- "Saved tab" listing (newest first per user).

CREATE TABLE IF NOT EXISTS "saved_templates" (
    "user_id" uuid NOT NULL,
    "template_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "saved_templates_pkey" PRIMARY KEY ("user_id", "template_id")
);
--> statement-breakpoint
ALTER TABLE "saved_templates"
    ADD CONSTRAINT "saved_templates_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "saved_templates"
    ADD CONSTRAINT "saved_templates_template_id_templates_id_fk"
    FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_templates_user_created_idx"
    ON "saved_templates" ("user_id", "created_at" DESC);
