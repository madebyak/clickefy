/**
 * One-shot sanity check that the schema we expect is actually on Neon.
 * Run with:  pnpm tsx scripts/verify.ts
 */
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(url);

async function main() {
  const start = Date.now();

  const tables = await sql<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `;

  const enums = await sql<{ enum_name: string; values: string }[]>`
    select t.typname as enum_name,
           string_agg(e.enumlabel, ',' order by e.enumsortorder) as values
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    group by t.typname
    order by t.typname
  `;

  const indexes = await sql<{ tablename: string; indexname: string }[]>`
    select tablename, indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname not like '%_pkey'
      and indexname not like '%_unique%'
    order by tablename, indexname
  `;

  console.log(`\nConnected to Neon in ${Date.now() - start} ms`);
  console.log(`\nTables (${tables.length}):`);
  for (const t of tables) console.log(`  • ${t.table_name}`);
  console.log(`\nEnums (${enums.length}):`);
  for (const e of enums) console.log(`  • ${e.enum_name} = [${e.values}]`);
  console.log(`\nIndexes (${indexes.length}):`);
  for (const i of indexes) console.log(`  • ${i.tablename}.${i.indexname}`);
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
