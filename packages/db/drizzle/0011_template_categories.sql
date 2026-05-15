-- 0011_template_categories.sql
--
-- Replace the single-FK `templates.category_id` with a many-to-many
-- `template_categories` join so a template can live in 1..3 categories
-- with exactly one marked as primary.
--
-- Migration shape (single transaction, runs end-to-end or not at all):
--   1. Create the join table + indexes.
--   2. Backfill: every existing template's `category_id` becomes its
--      primary membership row.
--   3. Drop the old `templates_category_status_idx` index.
--   4. Drop the FK constraint.
--   5. Drop the `category_id` column.
--
-- Safe for the current production state because:
--   - All existing rows have a non-null `category_id` (column is NOT
--     NULL), so the backfill SELECT covers 100% of them.
--   - No code path reads `category_id` after this migration applies —
--     the API + admin commits in this same change replace every site
--     with reads from `template_categories`.

-- ── 1. Join table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "template_categories" (
  "template_id" uuid NOT NULL,
  "category_id" uuid NOT NULL,
  "is_primary"  boolean NOT NULL DEFAULT false,
  "sort_order"  integer NOT NULL DEFAULT 0,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "template_categories_pk" PRIMARY KEY ("template_id", "category_id")
);--> statement-breakpoint

ALTER TABLE "template_categories"
  ADD CONSTRAINT "template_categories_template_id_templates_id_fk"
  FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "template_categories"
  ADD CONSTRAINT "template_categories_category_id_categories_id_fk"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Partial unique: at most one primary per template, enforced at the
-- database. The "exactly one" half of the invariant is enforced in
-- the API write path.
CREATE UNIQUE INDEX IF NOT EXISTS "template_categories_primary_uniq"
  ON "template_categories" ("template_id") WHERE "is_primary";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "template_categories_category_sort_idx"
  ON "template_categories" ("category_id", "sort_order");--> statement-breakpoint

-- ── 2. Backfill ─────────────────────────────────────────────────────
-- One row per existing template, marked primary. `ON CONFLICT DO NOTHING`
-- makes the migration idempotent if it's re-run after a partial apply.
INSERT INTO "template_categories" ("template_id", "category_id", "is_primary", "sort_order")
SELECT "id", "category_id", true, "sort_order"
FROM "templates"
WHERE "category_id" IS NOT NULL
ON CONFLICT ("template_id", "category_id") DO NOTHING;--> statement-breakpoint

-- ── 3. Drop the old per-category-on-templates index ─────────────────
DROP INDEX IF EXISTS "templates_category_status_idx";--> statement-breakpoint

-- ── 4. Drop the FK constraint ───────────────────────────────────────
ALTER TABLE "templates"
  DROP CONSTRAINT IF EXISTS "templates_category_id_categories_id_fk";--> statement-breakpoint

-- ── 5. Drop the column ──────────────────────────────────────────────
ALTER TABLE "templates" DROP COLUMN IF EXISTS "category_id";
