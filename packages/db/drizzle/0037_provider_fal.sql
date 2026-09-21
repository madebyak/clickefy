-- fal.ai joins the provider enum.
--
-- Additive only: adding a value to a Postgres enum rewrites nothing and
-- locks nothing, so this is safe to run against a live database while
-- jobs are in flight. No existing row changes meaning.
--
-- `IF NOT EXISTS` makes the migration re-runnable, which matters because
-- `ALTER TYPE ... ADD VALUE` cannot be rolled back — a half-applied
-- migration that cannot be retried is a bad afternoon.
ALTER TYPE "provider" ADD VALUE IF NOT EXISTS 'fal';
