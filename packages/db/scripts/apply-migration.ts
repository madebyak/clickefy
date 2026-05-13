/**
 * Apply a single SQL migration file directly via Neon's HTTP driver.
 *
 * Used when drizzle-kit's interactive `generate` flow is awkward — e.g.
 * for greenfield renames where we know the table is empty and can write
 * the migration by hand. The file is read in full and split on the
 * `--> statement-breakpoint` marker drizzle-kit also emits.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/apply-migration.ts drizzle/0001_template_kind_refactor.sql
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: pnpm tsx scripts/apply-migration.ts <path/to/file.sql>');
  process.exit(1);
}

const sql = neon(url);
const fullPath = resolve(process.cwd(), file);
const raw = readFileSync(fullPath, 'utf8');

// Strip line comments first so a chunk that starts with `-- ...` still
// gets recognised by its actual SQL content. Preserve the drizzle-kit
// `--> statement-breakpoint` delimiter — we still need that to split.
// Block comments (/* … */) are uncommon in our migrations; leave them.
const stripped = raw
  .split('\n')
  .map((line) => {
    const t = line.trim();
    if (t.startsWith('--> statement-breakpoint')) return line;
    if (t.startsWith('--')) return '';
    return line;
  })
  .join('\n');

// Drizzle-kit splits multi-statement migrations with this marker. Each
// chunk is a single statement so neon's HTTP driver can execute it.
const statements = stripped
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

async function main() {
  console.log(`Applying ${statements.length} statements from ${file}\n`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.split('\n')[0].slice(0, 80);
    console.log(`[${i + 1}/${statements.length}] ${preview}${preview.length === 80 ? '…' : ''}`);
    try {
      // neon-http's tagged template returns a callable that also accepts
      // a plain SQL string. Some DDL (CREATE INDEX, DROP TYPE) returns
      // no rows — neon happily resolves with `[]`.
      await (sql as unknown as (q: string) => Promise<unknown>)(stmt);
    } catch (err) {
      console.error(`Failed at statement ${i + 1}:`);
      console.error(stmt);
      throw err;
    }
  }

  console.log('\n✔ Migration applied');
}

main().catch((err) => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
