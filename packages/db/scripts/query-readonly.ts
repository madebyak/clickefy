/**
 * Read-only query runner for audits.
 *
 * Opens ONE Postgres session over WebSocket and sets
 * `default_transaction_read_only = on`, so the SERVER rejects any
 * INSERT / UPDATE / DELETE / DDL for the life of the session — the
 * guarantee is Postgres's, not this script's. Verified 2026-09-23: each
 * of those statement kinds fails with "cannot execute … in a read-only
 * transaction".
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/query-readonly.ts "<sql>" ["<sql>" ...]
 *   echo "select 1;" | DATABASE_URL=... pnpm tsx scripts/query-readonly.ts
 */
import { Client, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;
const url = process.env.DATABASE_URL!;
const stmts: string[] = process.argv.slice(2).length ? process.argv.slice(2)
  : require('fs').readFileSync(0, 'utf8').split(/;\s*\n/).map((s: string) => s.trim()).filter(Boolean);
(async () => {
  const c = new Client(url); await c.connect();
  await c.query('SET default_transaction_read_only = on');
  await c.query('SET statement_timeout = 60000');
  const ro = (await c.query('SHOW default_transaction_read_only')).rows[0];
  console.log(`[session read_only=${ro.default_transaction_read_only} host=${new URL(url).host}]`);
  for (const [i, s] of stmts.entries()) {
    console.log(`\n-- [${i}] ${s.replace(/\s+/g, ' ').slice(0, 110)}`);
    try {
      const r = await c.query(s);
      const rows = r.rows;
      if (rows.length && typeof rows[0] === 'object') {
        const keys = Object.keys(rows[0]);
        console.log(keys.join(' | '));
        for (const row of rows) console.log(keys.map(k => { const v = (row as any)[k]; return v === null ? '∅' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v); }).join(' | '));
      }
      console.log(`(${rows.length} rows)`);
    } catch (e: any) { console.log('ERR', e.message); }
  }
  await c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
