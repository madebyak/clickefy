-- 0010_credit_system.sql
--
-- Credit-system upgrade: per-bucket balances + admin-configurable pricing.
--
-- The big shape change is on users: a single `credits_balance` integer no
-- longer captures the rules we need (subscription credits reset on renewal;
-- top-up credits never expire but only spendable while subscribed; promo
-- credits — welcome bonus, weekly refresh, admin broadcasts — spendable
-- always). We model that as three bucket columns alongside the existing
-- `credits_balance` which becomes a denormalised sum kept in sync by the
-- application (and verifiable via `credit_ledger` SUMs).
--
-- The migration is additive everywhere; no existing column or row is
-- destroyed. Backfill of the new buckets uses the safest interpretation
-- for existing balances: every existing credit lands in `promo_credits`,
-- because that bucket is spendable regardless of subscription state and
-- never expires — strictly more permissive than what the user had before.

-- ── 1. Extend credit_reason enum with the new sources we record ─────────
-- `signup_bonus` is already present; we use it for the welcome bonus.
ALTER TYPE "credit_reason" ADD VALUE IF NOT EXISTS 'weekly_refresh';--> statement-breakpoint
ALTER TYPE "credit_reason" ADD VALUE IF NOT EXISTS 'broadcast_grant';--> statement-breakpoint
ALTER TYPE "credit_reason" ADD VALUE IF NOT EXISTS 'subscription_reset';--> statement-breakpoint

-- ── 2. Users: three bucket balances + backfill ──────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_credits" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "topup_credits" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "promo_credits" integer NOT NULL DEFAULT 0;--> statement-breakpoint

-- Backfill: dump the existing single balance into `promo_credits`.
-- Rationale: it preserves the user-visible balance, is always spendable
-- (no subscription gate), and never expires — strictly safer than any
-- other bucket choice for existing rows.
UPDATE "users"
SET "promo_credits" = "credits_balance"
WHERE "credits_balance" > 0 AND "promo_credits" = 0;--> statement-breakpoint

-- ── 3. Provider models: cost-in-credits per model ───────────────────────
ALTER TABLE "provider_models" ADD COLUMN IF NOT EXISTS "cost_credits" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "provider_models" ADD COLUMN IF NOT EXISTS "updated_by_admin_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint

-- ── 4. Credit ledger: per-row metadata + bucket attribution ─────────────
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "bucket" text;--> statement-breakpoint

-- ── 5. credit_packs (non-renewing consumable IAPs) ──────────────────────
CREATE TABLE IF NOT EXISTS "credit_packs" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_product_id"    text NOT NULL UNIQUE,
  "display_name"        text NOT NULL,
  "credits"             integer NOT NULL,
  "bonus_credits"       integer NOT NULL DEFAULT 0,
  "display_order"       integer NOT NULL DEFAULT 0,
  "is_featured"         boolean NOT NULL DEFAULT false,
  "is_active"           boolean NOT NULL DEFAULT true,
  "notes"               text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_by_admin_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "credit_packs_active_order_idx"
  ON "credit_packs" ("is_active", "display_order");--> statement-breakpoint

-- ── 6. subscription_plans (auto-renewable IAPs) ─────────────────────────
CREATE TABLE IF NOT EXISTS "subscription_plans" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_product_id"    text NOT NULL UNIQUE,
  "display_name"        text NOT NULL,
  "entitlement"         "entitlement" NOT NULL,
  "interval_unit"       text NOT NULL,
  "interval_count"      integer NOT NULL DEFAULT 1,
  "credits_per_period"  integer NOT NULL,
  "display_order"       integer NOT NULL DEFAULT 0,
  "is_featured"         boolean NOT NULL DEFAULT false,
  "is_active"           boolean NOT NULL DEFAULT true,
  "notes"               text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_by_admin_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "subscription_plans_active_order_idx"
  ON "subscription_plans" ("is_active", "display_order");--> statement-breakpoint

-- ── 7. grant_policies (welcome bonus + periodic free refresh) ───────────
CREATE TABLE IF NOT EXISTS "grant_policies" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"                text NOT NULL UNIQUE,
  "is_active"           boolean NOT NULL DEFAULT true,
  "amount"              integer NOT NULL,
  "period_unit"         text,
  "period_count"        integer DEFAULT 1,
  "audience"            jsonb NOT NULL DEFAULT '{"entitlement":"free"}'::jsonb,
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_by_admin_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
);--> statement-breakpoint

-- Seed defaults: 60-credit welcome bonus, 10-credit weekly refresh, both on.
INSERT INTO "grant_policies" ("kind", "is_active", "amount", "period_unit", "period_count", "audience")
VALUES
  ('welcome',               true, 60, NULL,   NULL, '{"entitlement":"free"}'::jsonb),
  ('periodic_free_refresh', true, 10, 'week', 1,    '{"entitlement":"free"}'::jsonb)
ON CONFLICT ("kind") DO NOTHING;--> statement-breakpoint

-- ── 8. credit_broadcasts (admin-initiated mass grants) ──────────────────
CREATE TABLE IF NOT EXISTS "credit_broadcasts" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "initiated_by_admin_id" uuid NOT NULL REFERENCES "users"("id"),
  "audience"              jsonb NOT NULL,
  "amount"                integer NOT NULL,
  "reason"                text NOT NULL,
  "push_title"            text,
  "push_body"             text,
  "recipient_count"       integer NOT NULL DEFAULT 0,
  "granted_count"         integer NOT NULL DEFAULT 0,
  "sent_at"               timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "credit_broadcasts_sent_at_idx"
  ON "credit_broadcasts" ("sent_at");
