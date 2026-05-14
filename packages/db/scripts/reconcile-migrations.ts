/**
 * Reconcile `drizzle.__drizzle_migrations` with the on-disk migration
 * folder. Tolerates a DB whose schema was previously synced via
 * `drizzle-kit push` (which skips the migrations table) by treating
 * "already exists" errors as expected for schema state we know is
 * already in place.
 *
 * For each entry in `drizzle/meta/_journal.json`, in order:
 *   1. Compute the hash drizzle would compute (sha256 of the SQL).
 *   2. If a row with that hash already exists, skip.
 *   3. Otherwise, run each statement (split on `--> statement-breakpoint`).
 *      Swallow Postgres duplicate-object errors (42710, 42P07, 42701, 42P06).
 *   4. Insert the (hash, created_at) row.
 *
 * After this script runs, `pnpm db:migrate` becomes a no-op until the
 * next new migration is added.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from '@neondatabase/serverless';

import journal from '../drizzle/meta/_journal.json';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'drizzle');

const TOLERATED_DUPLICATE_CODES = new Set(['42710', '42P07', '42701', '42P06']);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url });

  try {
    // Ensure the migrations table exists (drizzle creates it lazily;
    // we need it for our INSERTs to work if this script runs first).
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
      // Drizzle's migrator computes sha256 of the file's full text.
      const hash = createHash('sha256').update(raw).digest('hex');

      const existing = await pool.query(
        'SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1',
        [hash],
      );
      if (existing.rows.length > 0) {
        console.log(`✓ ${tag}: already recorded`);
        continue;
      }

      console.log(`→ ${tag}: applying...`);
      const statements = raw
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);

      for (const stmt of statements) {
        try {
          await pool.query(stmt);
        } catch (err) {
          const e = err as { code?: string; message?: string };
          if (e.code && TOLERATED_DUPLICATE_CODES.has(e.code)) {
            console.log(`  (already present, skipping: ${e.message?.slice(0, 100)})`);
            continue;
          }
          throw err;
        }
      }

      await pool.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [hash, entry.when],
      );
      console.log(`  recorded.`);
    }

    const all = await pool.query(
      'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
    );
    console.log(`\nDone. ${all.rows.length} migrations now tracked.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
