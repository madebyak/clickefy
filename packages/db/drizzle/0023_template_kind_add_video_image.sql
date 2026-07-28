-- 0023_template_kind_add_video_image.sql
--
-- Adds 'video_image' to the template_kind enum — templates whose result
-- is a video PLUS a still image (the pipeline already supports this via
-- generation.mode 'image_then_video' / output.type 'both'; this is the
-- user-facing kind for filtering + labeling).
--
-- SAFETY (same pattern as 0014_provider_enum_add_seedance):
--   • Purely additive — zero rows/columns/indexes touched.
--   • Atomic on PG 12+; <100ms on Neon. IF NOT EXISTS → re-runs no-op.
--   • MUST stay the only statement here: Postgres forbids USING a new
--     enum value inside the transaction that added it, so no seeds.
--   • Enum values cannot be removed later — the name is forever.

ALTER TYPE "template_kind" ADD VALUE IF NOT EXISTS 'video_image';
