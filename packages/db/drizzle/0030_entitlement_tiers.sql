-- New plan tiers, and the columns that make cross-platform subscriptions
-- possible.
--
-- TIERS
--   The catalogue moves from free/pro/pro_max to four named tiers:
--   basic / creator / pro / ultimate, each sold monthly or yearly.
--   `pro` already exists and keeps its meaning; `pro_max` is retired in
--   favour of `ultimate`.
--
--   Postgres cannot DROP a value from an enum without rewriting every
--   table that uses it, so `pro_max` stays in the type and is simply no
--   longer written. The three accounts holding it are internal test rows
--   and are migrated to `ultimate` below.
--
--   Each ADD VALUE is its own statement on purpose: a new enum value
--   cannot be USED in the same transaction that adds it, and
--   `apply-migration.ts` runs statements individually (each autocommits),
--   so by the time the UPDATE below runs, `ultimate` is committed and
--   usable. Running this migration through a single transaction would
--   fail on that UPDATE.
--
-- CROSS-PLATFORM COLUMNS
--   A subscription bought on the web must be visible to the mobile app —
--   showing it as the current plan and refusing to sell it again — and
--   vice versa. Neither Apple nor Stripe can see the other's
--   subscriptions; only our database can. These columns are what let the
--   paywall on each platform answer "where does this subscription live,
--   and where should I send them to change it?".
--
-- SAFETY
--   - Purely additive. Three enum values, three nullable columns, and one
--     UPDATE that touches only rows already holding a retired value.
--   - Nothing is dropped and no existing value is rewritten except
--     pro_max → ultimate, which is a rename of the same tier.
--   - Idempotent: ADD VALUE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, and
--     the UPDATE matches nothing on a second run.
--   - No credit column is touched. Balances cannot move.

ALTER TYPE "entitlement" ADD VALUE IF NOT EXISTS 'basic';
--> statement-breakpoint
ALTER TYPE "entitlement" ADD VALUE IF NOT EXISTS 'creator';
--> statement-breakpoint
ALTER TYPE "entitlement" ADD VALUE IF NOT EXISTS 'ultimate';
--> statement-breakpoint

-- Which platform owns this subscription, so we can route the user to the
-- right place to change or cancel it (Apple subscriptions can only be
-- cancelled in iOS Settings; Stripe ones in the Customer Portal).
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "subscription_platform" text;
--> statement-breakpoint

-- The exact product they are on, so the paywall can mark it as current
-- rather than offering it again.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "subscription_product_id" text;
--> statement-breakpoint

-- Stripe's identity for this user. Set on first web checkout and reused
-- for every later one, so a customer never ends up with two Stripe
-- customer records.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
--> statement-breakpoint

-- One Stripe customer maps to exactly one of our users. A partial index
-- so the many NULLs (every user who has never paid on the web) do not
-- collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "users_stripe_customer_uq"
  ON "users" ("stripe_customer_id")
  WHERE "stripe_customer_id" IS NOT NULL;
--> statement-breakpoint

-- Finding everyone on a given platform, for reconciliation sweeps.
CREATE INDEX IF NOT EXISTS "users_subscription_platform_idx"
  ON "users" ("subscription_platform")
  WHERE "subscription_platform" IS NOT NULL;
--> statement-breakpoint

-- Retire pro_max. Runs as its own statement so the enum value added above
-- is already committed and therefore usable.
UPDATE "users" SET "entitlement" = 'ultimate' WHERE "entitlement" = 'pro_max';
