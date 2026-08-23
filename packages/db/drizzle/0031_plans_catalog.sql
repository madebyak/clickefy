-- Plans, and the per-platform products that sell them.
--
-- THE PROBLEM THIS SOLVES
--   The same plan is sold on three storefronts at three different prices,
--   under three different product identifiers — Apple allows dots in a
--   product id, Google does not, and Stripe has its own. But the plan
--   itself (its tier, its billing interval, and above all HOW MANY
--   CREDITS it grants) must be identical everywhere.
--
--   `subscription_plans` keys everything off a single unique
--   `store_product_id`, which forces one row per storefront and therefore
--   one COPY OF THE CREDIT AMOUNT per storefront. Three copies of a
--   number that must never differ is a drift waiting to happen: a
--   repricing applied to two rows and missed on the third means web and
--   mobile customers on "the same plan" get different credits.
--
--   Splitting it fixes that by construction. Credits live in exactly one
--   place; only price and identifier vary per platform.
--
--     plans          tier + interval + credits_per_period   (8 rows)
--     plan_products  platform + store_product_id + price    (up to 24)
--
-- WHAT HAPPENS TO subscription_plans
--   It stays, untouched, until the Stripe and RevenueCat work has fully
--   cut over — the live RevenueCat webhook still reads it. Dropping it is
--   a later, separate step once nothing references it.
--
-- SAFETY
--   - Purely additive: two new tables. No existing table is altered,
--     no row rewritten, no column dropped.
--   - No credit column is touched. Balances cannot move.
--   - Existing `subscription_plans` rows are copied in, not moved, so the
--     old table remains authoritative until the cutover.
--   - Idempotent: IF NOT EXISTS throughout, and the copy skips anything
--     already present.

CREATE TABLE IF NOT EXISTS "plans" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'basic' | 'creator' | 'pro' | 'ultimate'. Deliberately text rather
  -- than the `entitlement` enum: a plan's tier and the entitlement it
  -- grants are the same today, but tying the catalogue to the enum means
  -- every future tier needs an enum migration before it can be drafted.
  "tier"               text NOT NULL,
  -- 'month' | 'year'.
  "interval"           text NOT NULL,
  -- THE number of credits this plan grants per period, on every platform.
  "credits_per_period" integer NOT NULL,
  "display_name"       text NOT NULL,
  "display_order"      integer NOT NULL DEFAULT 0,
  "is_active"          boolean NOT NULL DEFAULT true,
  "notes"              text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_by_admin_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,

  CONSTRAINT "plans_interval_check" CHECK ("interval" IN ('month', 'year')),
  CONSTRAINT "plans_credits_positive" CHECK ("credits_per_period" > 0),
  -- One plan per (tier, interval). This is what makes "Basic monthly"
  -- a single fact rather than three.
  CONSTRAINT "plans_tier_interval_uq" UNIQUE ("tier", "interval")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plans_active_order_idx"
  ON "plans" ("is_active", "display_order");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "plan_products" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_id"          uuid NOT NULL REFERENCES "plans"("id") ON DELETE CASCADE,
  -- 'stripe' | 'app_store' | 'play_store'.
  "platform"         text NOT NULL,
  -- The identifier the storefront knows this product by. This is what a
  -- webhook arrives carrying, and what we look the plan up from.
  "store_product_id" text NOT NULL,
  -- Display only. The storefront is always the source of truth for what
  -- the customer is actually charged, in their own currency; this is for
  -- admin screens and reporting.
  "price_usd"        numeric(10, 2),
  "is_active"        boolean NOT NULL DEFAULT true,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "plan_products_platform_check"
    CHECK ("platform" IN ('stripe', 'app_store', 'play_store')),
  -- A product id is unique within its storefront. This is the lookup a
  -- webhook does, so a duplicate would make the plan ambiguous.
  CONSTRAINT "plan_products_platform_product_uq" UNIQUE ("platform", "store_product_id"),
  -- And a plan is sold at most once per storefront.
  CONSTRAINT "plan_products_plan_platform_uq" UNIQUE ("plan_id", "platform")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plan_products_plan_idx"
  ON "plan_products" ("plan_id");
--> statement-breakpoint

-- Carry the existing catalogue across so nothing is stranded. The three
-- current rows are placeholders (`weekly` / `monthly` / `yearly`) with
-- product ids that are not real storefront identifiers, so they land as
-- app_store products to be corrected during the RevenueCat cutover.
-- `weekly` has no home in a monthly/yearly model and is skipped.
DO $$
DECLARE
  r RECORD;
  pid uuid;
BEGIN
  FOR r IN
    SELECT * FROM "subscription_plans"
    WHERE "interval_unit" IN ('month', 'year')
  LOOP
    INSERT INTO "plans" ("tier", "interval", "credits_per_period", "display_name", "display_order", "is_active", "notes")
    VALUES (
      r."entitlement"::text,
      r."interval_unit",
      r."credits_per_period",
      r."display_name",
      r."display_order",
      r."is_active",
      'migrated from subscription_plans'
    )
    ON CONFLICT ("tier", "interval") DO NOTHING
    RETURNING id INTO pid;

    IF pid IS NULL THEN
      SELECT id INTO pid FROM "plans"
      WHERE "tier" = r."entitlement"::text AND "interval" = r."interval_unit";
    END IF;

    INSERT INTO "plan_products" ("plan_id", "platform", "store_product_id", "is_active")
    VALUES (pid, 'app_store', r."store_product_id", r."is_active")
    ON CONFLICT ("platform", "store_product_id") DO NOTHING;
  END LOOP;

  RAISE NOTICE 'plans catalogue seeded from subscription_plans';
END $$;
