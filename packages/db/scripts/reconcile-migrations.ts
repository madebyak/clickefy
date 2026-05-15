/**
 * Reconcile `drizzle.__drizzle_migrations` with the on-disk migration
 * folder.
 *
 * IMPORTANT — this script must NEVER execute migration SQL.
 *
 * Background: the database was originally synced via `drizzle-kit push`,
 * which applies schema but does NOT write rows to
 * `drizzle.__drizzle_migrations`. The first time `db:migrate` runs after
 * a new migration file is added, Drizzle tries to apply every historical
 * migration in order and fails with "already exists" on objects that
 * `push` had created. The fix is to register the historical migrations
 * as already-applied — by inserting their hashes into the migrations
 * table — and then let Drizzle run only the unrecorded ones via
 * `db:migrate` as normal.
 *
 * The previous version of this script tried to be "smart": it ran each
 * statement and swallowed duplicate-object errors. That worked for
 * CREATE TYPE / CREATE TABLE etc. — but it ALSO re-ran any
 * non-idempotent statements in those historical migrations (TRUNCATE,
 * DELETE, ALTER … DROP COLUMN). On 2026-05-14 that re-ran the
 * `TRUNCATE templates / template_versions / jobs` in
 * 0001_template_kind_refactor.sql and wiped real production data.
 *
 * This rewrite does the only safe thing: record the migration as
 * applied without touching the schema. If the schema is OUT of sync
 * with the file (e.g. a hand-edited DB), that's a problem for the
 * developer to resolve manually — never by running historical SQL.
 *
 * Guard: if any of the well-known data tables already contain rows, we
 * refuse to run reconciliation against migrations whose files contain
 * `TRUNCATE` / `DELETE` / `DROP TABLE`. That's a belt-and-braces check
 * against an accidental future change — the primary safety is that we
 * never execute the file in the first place.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from '@neondatabase/serverless';

import journal from '../drizzle/meta/_journal.json';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'drizzle');

const DESTRUCTIVE_PATTERN = /\b(TRUNCATE|DELETE\s+FROM|DROP\s+TABLE)\b/i;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url });

  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    for (const entry of journal.entries) {
      const tag = entry.tag as string;
      const file = join(MIGRATIONS_DIR, `${tag}.sql`);
      const raw = await readFile(file, 'utf8');
      const hash = createHash('sha256').update(raw).digest('hex');

      const existing = await pool.query(
        'SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1',
        [hash],
      );
      if (existing.rows.length > 0) {
        console.log(`✓ ${tag}: already recorded`);
        continue;
      }

      // Hard safety: refuse to register a migration that contains
      // destructive SQL if the affected tables have rows. The intent
      // is to catch the exact failure mode that caused the 2026-05-14
      // incident — never silently treat a destructive historical
      // migration as "already applied" if its TRUNCATE clearly didn't
      // run yet.
      if (DESTRUCTIVE_PATTERN.test(raw)) {
        console.error(
          `✗ ${tag}: contains destructive SQL (TRUNCATE/DELETE/DROP TABLE).\n` +
            `  Refusing to mark as applied automatically. If you are sure the\n` +
            `  schema state already reflects this migration, INSERT the hash\n` +
            `  manually:\n\n` +
            `    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)\n` +
            `    VALUES ('${hash}', ${entry.when});\n`,
        );
        process.exitCode = 1;
        continue;
      }

      // Safe path: register without executing.
      await pool.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [hash, entry.when],
      );
      console.log(`→ ${tag}: recorded (no SQL executed)`);
    }

    const all = await pool.query(
      'SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations',
    );
    console.log(`\nDone. ${all.rows[0].c} migrations now tracked.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
