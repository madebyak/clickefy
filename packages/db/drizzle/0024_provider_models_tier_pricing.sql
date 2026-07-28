-- 0024_provider_models_tier_pricing.sql
--
-- Per-quality-tier pricing for models with selectable modes (Kling
-- std=720p / pro=1080p / 4k). `tier_pricing` holds ABSOLUTE credits per
-- mode key, e.g. {"std":70,"pro":94,"4k":188}. NULL (all existing rows)
-- = flat `cost_credits` for every tier — behavior unchanged.
--
-- SAFETY: purely additive nullable column; no row data touched by the
-- ALTER. The founder-directed seeds below only touch the two Kling v3
-- rows (kling-v3 priced 6% under Seedance 2's 100 credits at its
-- default pro tier; omni's existing 99 base preserved as its pro tier).

ALTER TABLE "provider_models" ADD COLUMN IF NOT EXISTS "tier_pricing" jsonb;
--> statement-breakpoint
UPDATE "provider_models"
SET "cost_credits" = 94,
    "tier_pricing" = '{"std": 70, "pro": 94, "4k": 188}'::jsonb
WHERE "provider" = 'kling' AND "model_key" = 'kling-v3';
--> statement-breakpoint
UPDATE "provider_models"
SET "tier_pricing" = '{"std": 74, "pro": 99, "4k": 198}'::jsonb
WHERE "provider" = 'kling' AND "model_key" = 'kling-v3-omni';
