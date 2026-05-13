CREATE TYPE "public"."credit_reason" AS ENUM('purchase', 'subscription_grant', 'job_charge', 'refund', 'admin_adjust', 'signup_bonus', 'daily_free');--> statement-breakpoint
CREATE TYPE "public"."entitlement" AS ENUM('free', 'pro', 'pro_max', 'admin');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'processing', 'completed', 'failed', 'purged');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('ar', 'en');--> statement-breakpoint
CREATE TYPE "public"."model_status" AS ENUM('active', 'preview', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('gemini', 'kling', 'veo');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."template_type" AS ENUM('image', 'video', 'image_then_video');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"icon_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"job_id" uuid,
	"revenuecat_transaction_id" text,
	"balance_after" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"progress" jsonb,
	"inputs" jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"trigger_run_id" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"purge_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider" NOT NULL,
	"model_key" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "model_status" DEFAULT 'active' NOT NULL,
	"capabilities" jsonb NOT NULL,
	"default_fallback_model_key" text,
	"cost_per_call_usd" numeric(10, 4) NOT NULL,
	"timeout_ms" integer DEFAULT 60000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_models_unique" UNIQUE("provider","model_key")
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"publish_note" text,
	CONSTRAINT "template_versions_unique_per_template" UNIQUE("template_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"short_description" text NOT NULL,
	"long_description" text DEFAULT '' NOT NULL,
	"category_id" uuid NOT NULL,
	"type" "template_type" NOT NULL,
	"status" "template_status" DEFAULT 'draft' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"cover_image" jsonb NOT NULL,
	"preview_gallery" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_can_choose_aspect_ratio" boolean DEFAULT false NOT NULL,
	"default_aspect_ratio" text,
	"generation" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"cost_credits" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"stats" jsonb DEFAULT '{"views":0,"runs":0,"successRate":0,"avgRuntimeMs":0}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"last_tested_at" timestamp with time zone,
	CONSTRAINT "templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"entitlement" "entitlement" DEFAULT 'free' NOT NULL,
	"credits_balance" integer DEFAULT 0 NOT NULL,
	"subscription_renews_at" timestamp with time zone,
	"subscription_expires_at" timestamp with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"purge_assets_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_sort_idx" ON "categories" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_created_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_revenuecat_idx" ON "credit_ledger" USING btree ("revenuecat_transaction_id");--> statement-breakpoint
CREATE INDEX "jobs_user_created_idx" ON "jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_created_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_template_completed_idx" ON "jobs" USING btree ("template_id","completed_at");--> statement-breakpoint
CREATE INDEX "jobs_purge_idx" ON "jobs" USING btree ("purge_at");--> statement-breakpoint
CREATE INDEX "jobs_idempotency_idx" ON "jobs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "templates_status_sort_idx" ON "templates" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "templates_category_status_idx" ON "templates" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "templates_featured_status_idx" ON "templates" USING btree ("featured","status");--> statement-breakpoint
CREATE INDEX "users_purge_idx" ON "users" USING btree ("purge_assets_at");--> statement-breakpoint
CREATE INDEX "users_entitlement_idx" ON "users" USING btree ("entitlement");