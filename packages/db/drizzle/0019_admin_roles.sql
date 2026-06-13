-- 0019_admin_roles.sql
--
-- Introduce a three-tier staff authorization model (superadmin / admin /
-- creator) decoupled from the billing `entitlement` column. See the
-- column-level rationale in `packages/db/src/schema/{enums,users}.ts` and
-- the capability matrix in `packages/types/src/admin.ts`.
--
-- Design:
--   • New `admin_role` enum. A user is staff iff `users.admin_role` is
--     non-null. Page-level capabilities each role maps to live in code
--     (`ROLE_DEFAULT_PAGES`), not the DB.
--   • `users.admin_role`           — nullable role tier.
--   • `users.admin_page_overrides` — nullable JSONB { grant[], revoke[] }
--     layered on top of the role default per user.
--   • Backfill: every current `entitlement = 'admin'` user becomes a
--     `superadmin`. This PRESERVES today's all-powerful behavior so no
--     existing admin loses any access at the moment the gate flips; the
--     owner can then demote peers to `admin`/`creator` in the new Team UI.
--
-- Anti-lockout: `withAdmin()` keeps a dual-check during rollout
-- (`admin_role IS NOT NULL OR entitlement = 'admin'`), so even a row this
-- backfill somehow missed cannot lock an existing admin out. The legacy
-- clause is removed only after verifying every admin has a role.
--
-- Safety:
--   • Pure additive migration. No column dropped, no row deleted, no
--     existing data rewritten beyond stamping a role onto admins.
--   • `IF NOT EXISTS` / duplicate_object guards on every object so a
--     partial re-run is a no-op rather than an error.
--   • The `entitlement` column and its `'admin'` enum value are left
--     fully intact for the transition window.
--   • Destructive-pattern guard in
--     `packages/db/scripts/reconcile-migrations.ts` only matches
--     TRUNCATE / DELETE FROM / DROP TABLE. None of those appear here.

-- ── 1. Enum ─────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "admin_role" AS ENUM ('superadmin', 'admin', 'creator');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ── 2. Columns ──────────────────────────────────────────────────────
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "admin_role" "admin_role";
--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "admin_page_overrides" jsonb;
--> statement-breakpoint

-- ── 3. Index (staff lookups for the Team page) ──────────────────────
CREATE INDEX IF NOT EXISTS "users_admin_role_idx"
  ON "users" ("admin_role");
--> statement-breakpoint

-- ── 4. Backfill existing admins → superadmin ────────────────────────
-- Idempotent: only fills rows that are admins-by-entitlement and have no
-- role yet, so re-running never clobbers a deliberate demotion.
UPDATE "users"
  SET "admin_role" = 'superadmin'
  WHERE "entitlement" = 'admin'
    AND "admin_role" IS NULL;
