/**
 * Snapshot every money-bearing table to a timestamped JSON file — READ ONLY.
 *
 * This is the restore point. Run it immediately before ANY write to the
 * credit system, and again afterwards to diff. `psql`/`pg_dump` are not
 * installed on this machine, and Neon's point-in-time restore depends on a
 * history window that varies by plan — so a self-contained file we control
 * is the one backstop that is always available.
 *
 * These tables are small (the whole database is ~15 MB), so a complete
 * dump costs nothing and is far more useful than a partial one.
 *
 * The companion `--verify <file>` mode re-reads the database and reports
 * exactly what changed since a snapshot: row counts per table, and a
 * per-user credit diff. It is the proof that a migration did only what it
 * said it would.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/backup-money-tables.ts
 *   DATABASE_URL=... pnpm tsx scripts/backup-money-tables.ts --out /path/before.json
 *   DATABASE_URL=... pnpm tsx scripts/backup-money-tables.ts --verify /path/before.json
 */

import { neon } from '@neondatabase/serverless';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = neon(url);
const q = <T = Record<string, unknown>>(s: string) =>
  sql(Object.assign([s], { raw: [s] }) as unknown as TemplateStringsArray) as unknown as Promise<T[]>;

/**
 * Everything that holds, describes or records money. `users` is included
 * whole rather than just its credit columns — entitlement and subscription
 * dates are part of the money state and are what a restore would need.
 */
const MONEY_TABLES = [
  'users',
  'credit_lots',
  'credit_ledger',
  'credit_packs',
  'credit_broadcasts',
  'subscription_plans',
  'grant_policies',
  'provider_models',
  'revenuecat_events',
] as const;

interface Snapshot {
  takenAt: string;
  host: string;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
  creditTotals: { balance: number; promo: number; subscription: number; topup: number };
}

async function tableExists(name: string): Promise<boolean> {
  const r = await q<{ n: number }>(
    `select count(*)::int n from information_schema.tables
     where table_schema='public' and table_name='${name}'`,
  );
  return (r[0]?.n ?? 0) > 0;
}

async function capture(): Promise<Snapshot> {
  const host = new URL(url!.replace('postgresql://', 'https://')).hostname;
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const t of MONEY_TABLES) {
    if (!(await tableExists(t))) {
      console.log(`  · ${t} — not present here, skipped`);
      continue;
    }
    const rows = await q(`select * from "${t}"`);
    tables[t] = rows;
    counts[t] = rows.length;
    console.log(`  · ${t.padEnd(20)} ${String(rows.length).padStart(5)} row(s)`);
  }

  const totals = await q<{ balance: number; promo: number; sub: number; topup: number }>(`
    select coalesce(sum(credits_balance),0)::int balance,
           coalesce(sum(promo_credits),0)::int promo,
           coalesce(sum(subscription_credits),0)::int sub,
           coalesce(sum(topup_credits),0)::int topup
    from users`);

  return {
    takenAt: new Date().toISOString(),
    host,
    tables,
    counts,
    creditTotals: {
      balance: totals[0]!.balance,
      promo: totals[0]!.promo,
      subscription: totals[0]!.sub,
      topup: totals[0]!.topup,
    },
  };
}

async function verify(path: string) {
  const before: Snapshot = JSON.parse(readFileSync(path, 'utf8'));
  console.log(`Comparing against ${path}`);
  console.log(`  snapshot taken ${before.takenAt} on ${before.host}\n`);

  const after = await capture();
  if (after.host !== before.host) {
    console.log(`\n*** DIFFERENT DATABASE — snapshot is ${before.host}, this is ${after.host} ***`);
    process.exit(1);
  }

  console.log('\nRow counts:');
  let changed = 0;
  for (const t of MONEY_TABLES) {
    const b = before.counts[t];
    const a = after.counts[t];
    if (b === undefined && a === undefined) continue;
    const delta = (a ?? 0) - (b ?? 0);
    if (delta !== 0) changed += 1;
    console.log(
      `  ${delta === 0 ? '=' : delta > 0 ? '+' : '-'} ${t.padEnd(20)} ${b ?? '—'} → ${a ?? '—'}${delta !== 0 ? `  (${delta > 0 ? '+' : ''}${delta})` : ''}`,
    );
  }

  console.log('\nCredit totals across all users:');
  const keys = ['balance', 'promo', 'subscription', 'topup'] as const;
  let creditsMoved = false;
  for (const k of keys) {
    const b = before.creditTotals[k];
    const a = after.creditTotals[k];
    if (b !== a) creditsMoved = true;
    console.log(`  ${b === a ? '=' : '≠'} ${k.padEnd(14)} ${b} → ${a}${b !== a ? `  (${a - b > 0 ? '+' : ''}${a - b})` : ''}`);
  }

  // Per-user credit movement — the detail that matters most.
  const beforeUsers = new Map(
    (before.tables['users'] as Array<Record<string, unknown>> | undefined ?? []).map((u) => [
      u.id as string,
      u,
    ]),
  );
  const moved: string[] = [];
  for (const u of (after.tables['users'] as Array<Record<string, unknown>>) ?? []) {
    const b = beforeUsers.get(u.id as string);
    if (!b) {
      moved.push(`    NEW USER ${u.email} balance=${u.credits_balance}`);
      continue;
    }
    if (b.credits_balance !== u.credits_balance) {
      moved.push(`    ${u.email}: ${b.credits_balance} → ${u.credits_balance}`);
    }
  }
  for (const id of beforeUsers.keys()) {
    if (!((after.tables['users'] as Array<Record<string, unknown>>) ?? []).some((u) => u.id === id)) {
      moved.push(`    *** USER DELETED: ${beforeUsers.get(id)!.email} ***`);
    }
  }
  if (moved.length > 0) {
    console.log('\nPer-user balance changes:');
    for (const m of moved) console.log(m);
  }

  console.log(
    `\n${changed === 0 && !creditsMoved && moved.length === 0 ? '✔ nothing changed' : `${changed} table(s) changed row count; ${moved.length} user balance(s) moved`}`,
  );
}

async function main() {
  const verifyIdx = process.argv.indexOf('--verify');
  if (verifyIdx !== -1) {
    const path = process.argv[verifyIdx + 1];
    if (!path) {
      console.error('--verify needs a snapshot file path');
      process.exit(1);
    }
    await verify(path);
    return;
  }

  const outIdx = process.argv.indexOf('--out');
  const host = new URL(url!.replace('postgresql://', 'https://')).hostname.split('.')[0];
  const out =
    outIdx !== -1 && process.argv[outIdx + 1]
      ? process.argv[outIdx + 1]!
      : `./money-backup-${host}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

  console.log(`Snapshotting money tables from ${host}\n`);
  const snap = await capture();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snap, null, 2));
  console.log(`\n✔ restore point written: ${out}`);
  console.log(`  totals — balance ${snap.creditTotals.balance}cr` +
    ` (promo ${snap.creditTotals.promo} / sub ${snap.creditTotals.subscription} / topup ${snap.creditTotals.topup})`);
  console.log(`\n  After your change, diff with:`);
  console.log(`    DATABASE_URL=... pnpm tsx scripts/backup-money-tables.ts --verify ${out}`);
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
