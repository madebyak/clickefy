-- 0018_localization_translations.sql
--
-- Introduce per-row localization (Arabic, and any future locale) for the
-- three user-facing content tables. See the column-level rationale in
-- `packages/db/src/schema/{templates,categories,home-banners}.ts`.
--
-- Design:
--   • English remains the canonical content in the existing columns
--     (`title`, `description`, `name`, `subtitle`, `cta_label`, …) and is
--     the guaranteed fallback. The new `translations` JSONB holds ONLY the
--     non-English overrides, keyed by locale, e.g.
--         {"ar": {"title": "...", "description": "...",
--                 "userInputs": {"<fieldKey>": {"label": "..."}}}}
--   • Anything missing for a locale falls back to the English column at
--     the API layer (`templateToMobileDTO` / category + banner DTOs).
--
-- Safety:
--   • Pure additive migration. No existing column dropped, no row touched,
--     no data rewritten. Postgres adds a nullable JSONB column in O(1)
--     (metadata-only, no full-table rewrite).
--   • `IF NOT EXISTS` on every statement so a partial re-run is a no-op
--     rather than an error.
--   • No NOT NULL, no default, no CHECK, no index — existing rows simply
--     observe NULL (interpreted as "no translations yet" → English).
--   • Destructive-pattern guard in
--     `packages/db/scripts/reconcile-migrations.ts` only matches
--     TRUNCATE / DELETE FROM / DROP TABLE. None of those appear here.

ALTER TABLE "templates"
  ADD COLUMN IF NOT EXISTS "translations" jsonb;
--> statement-breakpoint
ALTER TABLE "categories"
  ADD COLUMN IF NOT EXISTS "translations" jsonb;
--> statement-breakpoint
ALTER TABLE "home_banners"
  ADD COLUMN IF NOT EXISTS "translations" jsonb;
