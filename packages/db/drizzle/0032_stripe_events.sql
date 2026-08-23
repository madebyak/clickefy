-- Stripe webhook event log.
--
-- Mirrors `revenuecat_events` deliberately, because that design has already
-- proved itself in production and its most important property is subtle:
--
--   DEDUPE IS PROCESSING-STATE-AWARE. A replay of a SUCCESSFULLY processed
--   event short-circuits. A replay of a FAILED one RE-PROCESSES. That is
--   what turns "the product row wasn't registered yet" from a permanently
--   lost paid grant into something that heals itself the moment an operator
--   fixes the catalogue — Stripe keeps retrying for up to three days with
--   exponential backoff, and each retry gets a real attempt.
--
--   Storing only `event_id` and short-circuiting on its mere presence would
--   silently discard every retry of a failure, which is the opposite of
--   what we want from a money path.
--
-- The raw payload is kept whole. When a customer disputes what they were
-- charged, the event Stripe actually sent is the only account that matters,
-- and reconstructing it from our own derived rows is not the same thing.
--
-- SAFETY
--   - Purely additive: one new table. Nothing else is touched.
--   - `user_id` is ON DELETE SET NULL, so deleting a user keeps the
--     financial record — the event still happened.

CREATE TABLE IF NOT EXISTS "stripe_events" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stripe's own event id (evt_…). UNIQUE is the idempotency anchor.
  "event_id"          text NOT NULL UNIQUE,
  "event_type"        text NOT NULL,
  -- Stripe's customer id (cus_…) as it appeared on the event, even if we
  -- cannot resolve it to a user yet.
  "stripe_customer_id" text,
  "user_id"           uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "subscription_id"   text,
  "invoice_id"        text,
  "payload"           jsonb NOT NULL,
  -- NULL while unprocessed or failed; set only on success. This column IS
  -- the dedupe rule.
  "processed_at"      timestamptz,
  "processing_error"  text,
  "event_created_at"  timestamptz NOT NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- The retry sweep: anything that arrived but never completed.
CREATE INDEX IF NOT EXISTS "stripe_events_unprocessed_idx"
  ON "stripe_events" ("processed_at", "created_at" DESC);
--> statement-breakpoint

-- "What has this customer been charged?" — the support question.
CREATE INDEX IF NOT EXISTS "stripe_events_user_idx"
  ON "stripe_events" ("user_id", "created_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "stripe_events_customer_idx"
  ON "stripe_events" ("stripe_customer_id", "created_at" DESC);
--> statement-breakpoint

-- Tracing every event belonging to one subscription, in order.
CREATE INDEX IF NOT EXISTS "stripe_events_subscription_idx"
  ON "stripe_events" ("subscription_id", "created_at" DESC)
  WHERE "subscription_id" IS NOT NULL;
