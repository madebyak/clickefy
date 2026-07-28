/**
 * Seed Arabic (and future-locale) category translations in bulk.
 *
 * Reads a slug-keyed worksheet and writes ONLY the `translations` JSONB
 * column on `categories` — never `name`, `slug`, `parentId`, `iconUrl`,
 * or `sortOrder`. English stays canonical; Arabic is an additive override.
 *
 * Safety model:
 *   - DRY RUN BY DEFAULT. Prints the exact diff and any worksheet slug
 *     that doesn't match a live row. Pass `--apply` to actually write.
 *   - Matches on `slug` (stable + unique), never on id or name.
 *   - Additive merge: existing `translations` (and any other locales) are
 *     preserved; we only set `translations.<locale>.name`.
 *   - Idempotent: a row already holding the target value is skipped, so
 *     re-running is a no-op and a partial run can be safely re-run.
 *   - Blank `ar` values are skipped — clearing must be explicit, never a
 *     side effect of an empty worksheet cell.
 *
 * Usage:
 *   # preview (no writes):
 *   DATABASE_URL=... pnpm --filter @clickfy/db db:seed-category-translations
 *   # apply:
 *   DATABASE_URL=... pnpm --filter @clickfy/db db:seed-category-translations -- --apply
 *   # custom worksheet / locale:
 *   ... db:seed-category-translations -- --file data/category-translations.ar.json --locale ar --apply
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { neon } from '@neondatabase/serverless';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';

import type { CategoryTranslations } from '@clickfy/types';

import * as schema from '../src/schema';
import { categories } from '../src/schema';

// ─── Args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const getFlag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const locale = (getFlag('--locale') ?? 'ar') as keyof CategoryTranslations;
const fileArg = getFlag('--file') ?? 'data/category-translations.ar.json';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

// Resolve the worksheet relative to the package root (one level up from
// /scripts) when a bare/relative path is given.
const worksheetPath = fileArg.startsWith('/')
  ? fileArg
  : fileURLToPath(new URL(`../${fileArg}`, import.meta.url));

interface WorksheetEntry {
  en?: string;
  ar?: string;
  [locale: string]: string | undefined;
}

const sql = neon(url);
const db = drizzle(sql, { schema });

function loadWorksheet(): Record<string, WorksheetEntry> {
  const raw = JSON.parse(readFileSync(worksheetPath, 'utf8')) as Record<
    string,
    WorksheetEntry
  >;
  // Strip meta keys (anything starting with `_`, e.g. `_comment`).
  const out: Record<string, WorksheetEntry> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_')) continue;
    out[key] = value;
  }
  return out;
}

async function main() {
  const worksheet = loadWorksheet();
  const rows = await db.query.categories.findMany();
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  const planned: Array<{
    slug: string;
    name: string;
    from: string;
    to: string;
    id: string;
    merged: CategoryTranslations;
  }> = [];
  const unmatched: string[] = [];
  let skippedBlank = 0;
  let alreadySet = 0;

  for (const [slug, entry] of Object.entries(worksheet)) {
    const value = (entry[locale] ?? '').trim();
    if (!value) {
      skippedBlank += 1;
      continue;
    }
    const row = bySlug.get(slug);
    if (!row) {
      unmatched.push(slug);
      continue;
    }
    const existing = (row.translations ?? {}) as CategoryTranslations;
    const current = existing[locale]?.name;
    if (current === value) {
      alreadySet += 1;
      continue;
    }
    // Additive merge — keep every other locale and any future fields.
    const merged: CategoryTranslations = {
      ...existing,
      [locale]: { ...existing[locale], name: value },
    };
    planned.push({
      slug,
      name: row.name,
      from: current ?? '—',
      to: value,
      id: row.id,
      merged,
    });
  }

  // Coverage: live rows with no worksheet entry at all.
  const worksheetSlugs = new Set(Object.keys(worksheet));
  const missingFromWorksheet = rows
    .map((r) => r.slug)
    .filter((s) => !worksheetSlugs.has(s));

  console.log(`Worksheet: ${worksheetPath}`);
  console.log(`Locale:    ${String(locale)}`);
  console.log(`Mode:      ${apply ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  if (planned.length > 0) {
    console.log(`Changes (${planned.length}):`);
    for (const p of planned) {
      console.log(`  • ${p.slug.padEnd(14)} ${p.name.padEnd(14)} ${p.from}  →  ${p.to}`);
    }
  } else {
    console.log('No changes — every matched row already holds the target value.');
  }
  console.log('');
  console.log(`Already up to date: ${alreadySet}`);
  console.log(`Skipped (blank ${String(locale)}): ${skippedBlank}`);

  if (unmatched.length > 0) {
    console.warn(
      `\n⚠ ${unmatched.length} worksheet slug(s) had NO matching category (typo?): ${unmatched.join(', ')}`,
    );
  }
  if (missingFromWorksheet.length > 0) {
    console.warn(
      `\nℹ ${missingFromWorksheet.length} live categor(y/ies) have no worksheet entry yet: ${missingFromWorksheet.join(', ')}`,
    );
  }

  if (!apply) {
    console.log('\nDRY RUN complete. Re-run with `-- --apply` to write these changes.');
    return;
  }

  if (planned.length === 0) {
    console.log('\nNothing to write.');
    return;
  }

  console.log(`\nApplying ${planned.length} update(s)…`);
  for (const p of planned) {
    await db
      .update(categories)
      .set({ translations: p.merged, updatedAt: new Date() })
      .where(eq(categories.id, p.id));
    console.log(`  ✔ ${p.slug} → ${p.to}`);
  }
  console.log('\n✔ Done.');
}

main().catch((err) => {
  console.error('\nSeed failed:', err);
  process.exit(1);
});
