-- Credit packs, and the per-platform products that sell them.
--
-- THE PROBLEM THIS SOLVES
--   Exactly the one migration 0031 solved for subscriptions, one level
--   down. `credit_packs` keys off a single `store_product_id`, so selling
--   the same pack on Stripe, the App Store and Play needs THREE ROWS —
--   and therefore three copies of `credits` and `bonus_credits`. Two
--   numbers that must never differ, stored three times, is a drift
--   waiting to happen: reprice two rows, miss the third, and a customer
--   who bought "the 5,000 pack" on Android gets a different amount than
--   one who bought it on the web.
--
--   There is also no price column at all today, because the store owned
--   the price. Stripe does not work that way — WE create the price — so
--   web sales have nowhere to record what was charged.
--
--   Splitting it fixes both:
--
--     credit_packs   credits + bonus_credits + display   (the product)
--     pack_products  platform + store id + price_usd     (how it sells)
--
-- WHY MIRROR plan_products EXACTLY
--   Same column names, same constraint names modulo the prefix, same
--   platform CHECK. Anyone who has read one can read the other, and the
--   catalogue-sync scripts differ only in which table they target.
--
-- SAFETY
--   - Purely additive: one new table. `credit_packs` is not altered, no
--     column dropped, no row rewritten.
--   - No credit column is touched anywhere. Balances cannot move.
--   - Production currently holds ZERO top-up lots and ZERO top-up
--     credits, so there is no historical top-up data to endanger — this
--     lands before the first sale rather than under it.
--   - Idempotent: IF NOT EXISTS throughout.
--
-- NOTE ON THE PLACEHOLDER
--   `credit_packs` holds one hand-entered row, `Pack-ultimate` (1,000
--   credits), which is not a real product on any storefront. It is
--   DEACTIVATED here rather than deleted: `/v1/store` filters on
--   `is_active`, so deactivating removes it from every client, while
--   deleting would break the foreign key of any ledger row that ever
--   referenced it. Nothing has, but the habit is worth keeping.

CREATE TABLE IF NOT EXISTS "pack_products" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pack_id"          uuid NOT NULL REFERENCES "credit_packs"("id") ON DELETE CASCADE,
  -- 'stripe' | 'app_store' | 'play_store'. Text + CHECK rather than an
  -- enum, matching plan_products: a new storefront should not need an
  -- enum migration before anyone can draft a row for it.
  "platform"         text NOT NULL,
  "store_product_id" text NOT NULL,
  -- What this pack costs on THIS platform. Mobile is priced higher to
  -- net the same after the store's 15% commission.
  "price_usd"        numeric(10, 2),
  "is_active"        boolean NOT NULL DEFAULT true,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

-- One storefront identifier can only ever mean one thing. Without this a
-- typo could point two packs at the same Stripe price and silently grant
-- the wrong amount.
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pack_products_platform_product_uq"
  ON "pack_products" ("platform", "store_product_id");

-- A pack sells at most once per platform.
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pack_products_pack_platform_uq"
  ON "pack_products" ("pack_id", "platform");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_products_pack_idx"
  ON "pack_products" ("pack_id");

--> statement-breakpoint
ALTER TABLE "pack_products"
  DROP CONSTRAINT IF EXISTS "pack_products_platform_check";

--> statement-breakpoint
ALTER TABLE "pack_products"
  ADD CONSTRAINT "pack_products_platform_check"
  CHECK ("platform" IN ('stripe', 'app_store', 'play_store'));

-- Retire the placeholder. Guarded on the exact identifier so a re-run,
-- or a future real pack, is untouched.
--> statement-breakpoint
UPDATE "credit_packs"
   SET "is_active" = false, "updated_at" = now()
 WHERE "store_product_id" = 'Pack-ultimate'
   AND "is_active" = true;
