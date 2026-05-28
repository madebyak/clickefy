-- 0017_home_banners.sql
--
-- Introduce the `home_banners` table that powers the new dynamic
-- banner strip rendered above the "Trending Now" rail on the mobile
-- home screen. See `packages/db/src/schema/home-banners.ts` for the
-- column-level rationale; this migration is the DDL it implies.
--
-- Safety:
--   • Pure additive migration. No existing column dropped, no row
--     touched. New types, new table, new index — that's it.
--   • IF NOT EXISTS guards on every object so a partial re-run is a
--     no-op rather than an error.
--   • Destructive-pattern guard in
--     `packages/db/scripts/reconcile-migrations.ts` only matches
--     TRUNCATE / DELETE FROM / DROP TABLE. None of those appear here.

-- ── 1. Enums ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "home_banner_kind" AS ENUM ('image', 'image_slider', 'video');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "home_banner_cta_kind" AS ENUM ('none', 'template', 'category', 'external_url');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ── 2. Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "home_banners" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"        "home_banner_kind" NOT NULL,
  "media"       jsonb NOT NULL DEFAULT '[]'::jsonb,
  "title"       text,
  "subtitle"    text,
  "cta_label"   text,
  "cta_kind"    "home_banner_cta_kind" NOT NULL DEFAULT 'none',
  "cta_target"  text,
  "sort_order"  integer NOT NULL DEFAULT 0,
  "is_active"   boolean NOT NULL DEFAULT true,
  "starts_at"   timestamp with time zone,
  "ends_at"     timestamp with time zone,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- ── 3. Index for the public list query ──────────────────────────────
-- Public endpoint runs:
--   WHERE is_active = true AND (now BETWEEN starts_at..ends_at)
--   ORDER BY sort_order ASC, created_at DESC
-- This composite index covers the WHERE prefix + ORDER BY direction.
CREATE INDEX IF NOT EXISTS "home_banners_active_sort_idx"
  ON "home_banners" ("is_active", "sort_order");
