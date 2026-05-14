-- jobs_user_pagination_idx — matches the cursor pagination tuple in
-- `GET /v1/jobs`: `ORDER BY (created_at DESC, id DESC)` with
-- `WHERE (created_at, id) < (cursor_ts, cursor_id)`. Lets Postgres
-- do an index-only seek and removes the tiebreak sort when two
-- inserts happen to share the same microsecond `now()` timestamp.
--
-- We keep the existing `jobs_user_created_idx` ((user_id, created_at)
-- ASC) so this deploy is purely additive — no live index drop.
-- `CREATE INDEX CONCURRENTLY` is omitted because Drizzle's migration
-- runner wraps each file in a transaction (CONCURRENTLY can't run
-- inside one), and the jobs table is small enough at current scale
-- that the brief lock is acceptable. If/when the table grows past
-- ~10M rows, switch to a manual CONCURRENTLY run outside the
-- migration runner.

CREATE INDEX IF NOT EXISTS "jobs_user_pagination_idx"
    ON "jobs" ("user_id", "created_at" DESC NULLS LAST, "id" DESC NULLS LAST);
