-- Credit lots — per-grant credit tracking with expiry.
--
-- WHY
--   Credits live in three integer columns on `users` (promo / subscription
--   / topup). That cannot express "this particular purchase expires on this
--   particular date", which is exactly what top-up expiry needs: two packs
--   bought five months apart have two different expiry dates and one
--   integer cannot hold two dates.
--
--   The industry model is a "lot" (Orb calls them blocks) — one row per
--   credit-issuing event, consumed FIFO by expiry. It also collapses the
--   spend-priority rule into a single ORDER BY:
--
--     ORDER BY expires_at ASC NULLS LAST, created_at ASC
--
--   subscription credits expire at period end (~30d) → spent first
--   top-ups expire in 12 months                      → spent second
--   welcome / promo credits never expire (NULL)      → spent last
--
--   which is precisely the agreed order, falling out of one principle
--   rather than a hardcoded priority list.
--
-- RELATIONSHIP TO THE EXISTING COLUMNS
--   `users.promo_credits` / `subscription_credits` / `topup_credits` and
--   `credits_balance` REMAIN, as a maintained projection of these lots.
--   That keeps `/v1/credits/me`, the mobile UI and the
--   `users_balance_matches_buckets` CHECK (migration 0015) working
--   unchanged, and keeps a balance read to a single row. Every statement
--   that moves a lot must update the projection in the SAME statement.
--
-- SAFETY
--   - Additive: one new table, one nullable column on `credit_ledger`.
--     No existing column is dropped, rewritten, or reduced.
--   - The backfill + its verification run inside ONE `DO` block, so they
--     are atomic. `apply-migration.ts` executes statements individually
--     with no surrounding transaction, so a multi-statement backfill could
--     otherwise half-apply. If the lots do not reconcile to the existing
--     bucket columns for EVERY user, the block raises and rolls itself
--     back, leaving an empty table and nothing else changed.
--   - Idempotent: each backfill INSERT skips users that already have a lot
--     of that class, so re-running is a no-op.
--   - Grandfathering: existing top-up balances get `expires_at = NULL`.
--     Applying a new 12-month clock to credits that were sold under
--     different terms is not defensible; only NEW purchases get an expiry.

CREATE TABLE IF NOT EXISTS "credit_lots" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"            uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- Spend class. The allocator branches on this (top-ups are gated on an
  -- active subscription), so it is constrained; `kind` below is free-form
  -- provenance and deliberately is not.
  "class"              text NOT NULL,
  -- Where this grant came from: 'welcome' | 'subscription' | 'topup'
  -- | 'admin' | 'refund' | 'migrated'. Descriptive only.
  "kind"               text NOT NULL,
  "amount_granted"     integer NOT NULL,
  "amount_remaining"   integer NOT NULL,
  -- NULL = never expires.
  "expires_at"         timestamptz,
  -- Pause support: while a user is unsubscribed their top-up clock stops.
  -- `expires_at` is cleared and the life left is parked in
  -- `remaining_lifetime`, then rebuilt as now() + remaining_lifetime on
  -- resubscribe.
  "paused_at"          timestamptz,
  "remaining_lifetime" interval,
  "source_platform"    text,
  "source_ref"         text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "credit_lots_class_check"
    CHECK ("class" IN ('promo', 'subscription', 'topup')),
  CONSTRAINT "credit_lots_granted_positive"
    CHECK ("amount_granted" > 0),
  -- Cannot spend more than was granted, cannot go negative.
  CONSTRAINT "credit_lots_remaining_range"
    CHECK ("amount_remaining" >= 0 AND "amount_remaining" <= "amount_granted"),
  -- A paused lot must have parked its remaining life AND have no live
  -- expiry; an unpaused lot must have neither. Without this a half-applied
  -- pause would silently make credits eternal (expires_at cleared, nothing
  -- recorded to restore it).
  CONSTRAINT "credit_lots_pause_coherent" CHECK (
    ("paused_at" IS NULL AND "remaining_lifetime" IS NULL)
    OR ("paused_at" IS NOT NULL AND "remaining_lifetime" IS NOT NULL AND "expires_at" IS NULL)
  )
);
--> statement-breakpoint

-- The allocator's query: eligible lots for one user, soonest expiry first.
-- Partial, because spent-out lots are never candidates and would otherwise
-- dominate the index as history accumulates.
CREATE INDEX IF NOT EXISTS "credit_lots_alloc_idx"
  ON "credit_lots" ("user_id", "expires_at" NULLS LAST, "created_at")
  WHERE "amount_remaining" > 0;
--> statement-breakpoint

-- The daily expiry sweep: everything already past its date with credits
-- still on it.
CREATE INDEX IF NOT EXISTS "credit_lots_expiry_sweep_idx"
  ON "credit_lots" ("expires_at")
  WHERE "amount_remaining" > 0 AND "expires_at" IS NOT NULL;
--> statement-breakpoint

-- Resume-on-resubscribe: find this user's paused lots.
CREATE INDEX IF NOT EXISTS "credit_lots_paused_idx"
  ON "credit_lots" ("user_id")
  WHERE "paused_at" IS NOT NULL;
--> statement-breakpoint

-- Idempotency for externally-triggered grants. A replayed Stripe or
-- RevenueCat event carries the same `source_ref`, so the second insert
-- loses. Partial (`source_ref IS NOT NULL`) so internal grants — welcome
-- bonus, admin adjustment, refund — which have no external id are not
-- forced into a single row per kind.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_lots_source_ref_uq"
  ON "credit_lots" ("user_id", "kind", "source_ref")
  WHERE "source_ref" IS NOT NULL;
--> statement-breakpoint

-- Which lot a ledger row moved. Lets a refund return credits to exactly
-- the lots the charge drew from, rather than guessing a class.
ALTER TABLE "credit_ledger"
  ADD COLUMN IF NOT EXISTS "lot_id" uuid REFERENCES "credit_lots"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "credit_ledger_lot_idx"
  ON "credit_ledger" ("lot_id")
  WHERE "lot_id" IS NOT NULL;
--> statement-breakpoint

-- Backfill + verify, atomically.
DO $$
DECLARE
  mismatched integer;
  lots_made  integer;
BEGIN
  -- promo → never expires.
  INSERT INTO "credit_lots"
    ("user_id", "class", "kind", "amount_granted", "amount_remaining", "expires_at", "source_platform")
  SELECT u."id", 'promo', 'migrated', u."promo_credits", u."promo_credits", NULL, 'system'
  FROM "users" u
  WHERE u."promo_credits" > 0
    AND NOT EXISTS (
      SELECT 1 FROM "credit_lots" cl
      WHERE cl."user_id" = u."id" AND cl."class" = 'promo'
    );

  -- subscription → expires when the current period does. NULL when the
  -- user has credits but no recorded period (hand-set test rows); the
  -- next renewal replaces the lot wholesale either way.
  INSERT INTO "credit_lots"
    ("user_id", "class", "kind", "amount_granted", "amount_remaining", "expires_at", "source_platform")
  SELECT u."id", 'subscription', 'migrated', u."subscription_credits", u."subscription_credits",
         u."subscription_expires_at", 'system'
  FROM "users" u
  WHERE u."subscription_credits" > 0
    AND NOT EXISTS (
      SELECT 1 FROM "credit_lots" cl
      WHERE cl."user_id" = u."id" AND cl."class" = 'subscription'
    );

  -- topup → grandfathered with no expiry (see SAFETY above).
  INSERT INTO "credit_lots"
    ("user_id", "class", "kind", "amount_granted", "amount_remaining", "expires_at", "source_platform")
  SELECT u."id", 'topup', 'migrated', u."topup_credits", u."topup_credits", NULL, 'system'
  FROM "users" u
  WHERE u."topup_credits" > 0
    AND NOT EXISTS (
      SELECT 1 FROM "credit_lots" cl
      WHERE cl."user_id" = u."id" AND cl."class" = 'topup'
    );

  GET DIAGNOSTICS lots_made = ROW_COUNT;

  -- Every user's lots must reconcile to their existing bucket columns,
  -- per class. Anything else means the projection and the lots disagree
  -- from the very first moment, which is the one thing this table exists
  -- to make impossible.
  SELECT count(*) INTO mismatched
  FROM "users" u
  LEFT JOIN (
    SELECT "user_id",
      COALESCE(SUM("amount_remaining") FILTER (WHERE "class" = 'promo'), 0)        AS p,
      COALESCE(SUM("amount_remaining") FILTER (WHERE "class" = 'subscription'), 0) AS s,
      COALESCE(SUM("amount_remaining") FILTER (WHERE "class" = 'topup'), 0)        AS t
    FROM "credit_lots"
    GROUP BY "user_id"
  ) l ON l."user_id" = u."id"
  WHERE u."promo_credits"        <> COALESCE(l.p, 0)
     OR u."subscription_credits" <> COALESCE(l.s, 0)
     OR u."topup_credits"        <> COALESCE(l.t, 0);

  IF mismatched > 0 THEN
    RAISE EXCEPTION
      'credit_lots backfill does not reconcile for % user(s) — rolling back, no rows written',
      mismatched;
  END IF;

  RAISE NOTICE 'credit_lots backfill reconciled for every user (% lot(s) created in this run)', lots_made;
END $$;
