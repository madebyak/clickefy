-- 0015_credit_buckets_invariant.sql
--
-- Fix admin-granted / manually-edited credits that landed in
-- `users.credits_balance` without distributing into the three
-- bucket columns (promo / subscription / topup). Without this,
-- the atomic job-submit CTE in apps/api/src/lib/job-create.ts
-- refuses every spend and surfaces "Credits changed during
-- submission. Try again." even though the visible balance is
-- positive.
--
-- The migration is ADDITIVE EVERYWHERE — no row is deleted, no
-- column is dropped, no value is reduced. We only top up the
-- promo bucket to match credits_balance for any user where the
-- buckets currently undercount.
--
-- Then we add a CHECK constraint so this can never silently
-- drift again. If a future code path tries to UPDATE
-- credits_balance without touching the buckets, Postgres will
-- physically reject the write — matching the "fail loud"
-- principle from the 2026-05-14 incident postmortem.

-- ── 1. Backfill: ensure buckets sum >= credits_balance ──────────
-- For any user whose buckets undercount the visible balance, push
-- the missing amount into `promo_credits` (most permissive — always
-- spendable, never expires, no entitlement gate). Mirrors the
-- backfill choice made by migration 0010.
--
-- This UPDATE never reduces any column. It only ADDS to promo.
UPDATE "users"
SET "promo_credits" = "promo_credits"
                    + ("credits_balance"
                       - ("promo_credits" + "subscription_credits" + "topup_credits"))
WHERE "credits_balance"
      > ("promo_credits" + "subscription_credits" + "topup_credits");
--> statement-breakpoint

-- ── 2. CHECK constraint — buckets must match the visible balance ──
-- Postgres validates this against every existing row at ADD CONSTRAINT
-- time. If step 1 missed a case (e.g. a user where buckets > balance,
-- which would mean the buckets over-count), the ALTER fails and the
-- entire migration is rolled back inside its transaction. That's the
-- safe outcome — we never want to ship a partial fix.
ALTER TABLE "users"
  ADD CONSTRAINT "users_balance_matches_buckets"
  CHECK ("credits_balance" = "promo_credits" + "subscription_credits" + "topup_credits");
