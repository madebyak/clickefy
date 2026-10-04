-- Cost & profit tracking (Phase 2, feature 1).
--
-- WHY
--   Nothing recorded what a generation cost us. The credits a user paid
--   are on the job and in the ledger; the provider's dollars were nowhere.
--   Three additions:
--
--     jobs.provider               which adapter ran it (first stage)
--     jobs.provider_cost_usd      dollars we paid, frozen at completion / failure
--     jobs.provider_billed_units  how that number was reached, per stage
--                                 [{model, unit, quantity, unitPriceUsd, mode, basis}]
--     jobs.provider_request_ids   the provider's ids, one per async stage
--     jobs.cost_basis             'exact' (provider reported the units) |
--                                 'computed' (rate card × units) |
--                                 'estimated' (back-filled from history)
--
--     payments                    cash, one row per Stripe invoice or
--                                 checkout session (and later per store
--                                 transaction): amount, currency, refunds,
--                                 the credits it bought, when it happened.
--
--     provider_invoices           the monthly invoice total per provider,
--                                 typed in by an admin, so the dashboard
--                                 can show computed-vs-billed.
--
-- EXISTING ROWS — no jobs row is touched here. The back-fill script
--   (apps/api/scripts/backfill-costs.ts) fills the four cost columns with
--   basis 'estimated'. Payments are back-filled from stripe_events.
--
-- SAFETY
--   - All new columns nullable, IF NOT EXISTS → re-runnable.
--   - New tables only; no constraint on existing data; no credit column touched.

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "provider" text;
--> statement-breakpoint

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "provider_cost_usd" numeric(10, 5);
--> statement-breakpoint

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "provider_billed_units" jsonb;
--> statement-breakpoint

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "provider_request_ids" jsonb;
--> statement-breakpoint

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "cost_basis" text;
--> statement-breakpoint

ALTER TABLE "jobs"
  DROP CONSTRAINT IF EXISTS "jobs_cost_basis_check";
--> statement-breakpoint

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_cost_basis_check"
  CHECK ("cost_basis" IS NULL OR "cost_basis" IN ('exact', 'computed', 'estimated'));
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jobs_created_status_idx" ON "jobs" ("created_at", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "platform" text NOT NULL,
  "kind" text NOT NULL,
  "external_id" text NOT NULL,
  "payment_intent_id" text,
  "amount_cents" integer NOT NULL,
  "amount_refunded_cents" integer NOT NULL DEFAULT 0,
  "currency" text NOT NULL DEFAULT 'usd',
  "credits_granted" integer,
  "product_ref" text,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "payments_platform_check" CHECK ("platform" IN ('stripe', 'app_store', 'play_store')),
  CONSTRAINT "payments_kind_check" CHECK ("kind" IN ('subscription', 'pack'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payments_external_idx" ON "payments" ("platform", "external_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payments_occurred_idx" ON "payments" ("occurred_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payments_user_idx" ON "payments" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "provider_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" text NOT NULL,
  "month" date NOT NULL,
  "amount_usd" numeric(12, 2) NOT NULL,
  "note" text,
  "updated_by_admin_id" uuid,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "provider_invoices_month_idx" ON "provider_invoices" ("provider", "month");
