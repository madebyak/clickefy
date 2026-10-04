-- Cost & profit analytics (Phase 2, feature 1, dashboard).
--
-- WHY
--   The analytics endpoints join `credit_ledger` to `jobs` on `job_id`
--   to split what each job consumed into paid and promo credits, and to
--   net refunds against charges. The table had no index on `job_id`
--   (only user+created and the RevenueCat id), so every such join was a
--   sequential scan. Partial: most rows that are not charges or refunds
--   carry no job id.
--
-- SAFETY
--   Index only; no data touched; IF NOT EXISTS → re-runnable.

CREATE INDEX IF NOT EXISTS "credit_ledger_job_idx" ON "credit_ledger" ("job_id") WHERE "job_id" IS NOT NULL;
