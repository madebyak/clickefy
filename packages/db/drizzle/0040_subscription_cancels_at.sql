-- When a subscription is booked to end.
--
-- WHY
--   Stripe records "cancel at the end of the paid period" two ways —
--   `cancel_at_period_end` (what our own cancel route sets) and
--   `cancel_at` (what the Customer Portal writes on API 2026-07-29). We
--   mirrored neither. On 2026-09-24 four customers cancelled in the
--   portal and every surface of ours went on saying "Renews on …".
--
--   The webhook now writes the end date here whenever Stripe reports one,
--   and clears it on resume, so the billing page, `/v1/users/me` and the
--   mobile app can say "Ends on …" without a live Stripe read.
--
--     users.subscription_cancels_at   timestamptz, null = plan continues
--
-- EXISTING ROWS — nothing is filled here. The four known cancellations
--   are written by scripts/sync-stripe-cancellations.ts, which reads
--   Stripe and shows its plan before `--apply`. No credit column is touched.
--
-- SAFETY
--   - Column added nullable with IF NOT EXISTS → re-runnable.
--   - No default, no constraint, no backfill.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "subscription_cancels_at" timestamp with time zone;
