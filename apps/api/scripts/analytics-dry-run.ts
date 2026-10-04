/**
 * Run the analytics queries against a database and print what the
 * dashboard would show. READ ONLY: it only calls the SELECT helpers in
 * `src/lib/analytics-sql.ts` — no invoice writes, no job updates.
 *
 * Usage (from apps/api):
 *   DATABASE_URL=… pnpm tsx scripts/analytics-dry-run.ts [from] [to]
 */
import { createDb } from '@clickfy/db';
import { bucketKeys, monthKeys, parseAnalyticsRange } from '@clickfy/types';

import { EMPTY_AGG, cashSeries, costBreakdown, costSeries, exportJobs, invoiceComparison, listJobs, toTotals } from '../src/lib/analytics-sql';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const db = createDb({ connectionString: url, runtime: 'http' });

async function main() {
  const range = parseAnalyticsRange(process.argv[2] ?? '2026-05-01', process.argv[3]);
  console.log(`host=${new URL(url!).host} range ${range.from}..${range.to} (${range.fromUtc.toISOString()} → ${range.toUtc.toISOString()})\n`);

  const t0 = Date.now();
  const [costs, cash, invoices] = await Promise.all([
    costSeries(db, range, 'month', {}),
    cashSeries(db, range, 'month'),
    invoiceComparison(db, range, monthKeys(range)),
  ]);
  console.log(`/costs in ${Date.now() - t0} ms`);
  console.log('TOTALS', JSON.stringify(toTotals(costs.total, cash.total), null, 1).replace(/\n\s*/g, ' '));
  for (const k of bucketKeys(range, 'month')) {
    const t = toTotals(costs.byBucket.get(k) ?? EMPTY_AGG, cash.byBucket.get(k) ?? { count: 0, grossCents: 0, refundedCents: 0, netCents: 0, subscriptionCents: 0, packCents: 0 });
    console.log(`  ${k}  jobs=${String(t.jobs).padStart(5)} cost=$${t.costUsd.toFixed(2).padStart(8)} failedCost=$${t.failedCostUsd.toFixed(2).padStart(7)} creditsNet=${String(t.creditsNet).padStart(6)} paid=${String(t.paidCreditsNet).padStart(6)} promo=${String(t.promoCreditsNet).padStart(6)} value=$${t.creditValueUsd.toFixed(2).padStart(8)} profit=$${t.profitUsd.toFixed(2).padStart(8)} margin=${t.marginPct ?? '∅'}% cash=$${((t.cash?.netCents ?? 0) / 100).toFixed(2)}`);
  }
  console.log('INVOICES', invoices.map((i) => `${i.month} ${i.provider} computed=$${i.computedUsd} billed=${i.billedUsd ?? '∅'} jobs=${i.jobs}`).join(' | '));

  for (const dim of ['model', 'provider', 'origin', 'user', 'template'] as const) {
    const t1 = Date.now();
    const rows = await costBreakdown(db, range, {}, dim, 8);
    console.log(`\n/costs/by?dim=${dim} (${Date.now() - t1} ms, top ${rows.length})`);
    for (const r of rows) console.log(`  ${(r.label ?? r.key).slice(0, 40).padEnd(40)} ${(r.sublabel ?? '').slice(0, 18).padEnd(18)} jobs=${String(r.jobs).padStart(5)} cost=$${r.costUsd.toFixed(2).padStart(8)} paid=${String(r.paidCreditsNet).padStart(6)} value=$${r.creditValueUsd.toFixed(2).padStart(8)} profit=$${r.profitUsd.toFixed(2).padStart(8)} margin=${r.marginPct ?? '∅'}%${r.cashNetCents != null ? ` cash=$${(r.cashNetCents / 100).toFixed(2)}` : ''}`);
  }

  const t2 = Date.now();
  const page = await listJobs(db, range, {}, { limit: 3 });
  console.log(`\n/jobs first page (${Date.now() - t2} ms) total=${page.total} next=${page.nextCursor}`);
  for (const j of page.rows) console.log(' ', JSON.stringify({ ...j, billedUnits: j.billedUnits?.length ?? null }));
  const page2 = await listJobs(db, range, {}, { limit: 3, cursor: page.nextCursor ?? undefined });
  console.log(`page 2 ids: ${page2.rows.map((r) => r.id.slice(0, 8)).join(', ')} total=${page2.total}`);
  const filtered = await listJobs(db, range, { status: 'failed', provider: 'seedance' }, { limit: 2, search: 'aws-studios' });
  console.log(`filtered (failed, seedance, aws-studios): total=${filtered.total}`, filtered.rows.map((r) => `${r.user.email} ${r.errorCode} charged=${r.creditsCharged} refunded=${r.creditsRefunded} cost=${r.providerCostUsd}`));

  const t3 = Date.now();
  const exp = await exportJobs(db, range, {}, 20_000);
  console.log(`\nexport rows=${exp.rows.length} truncated=${exp.truncated} (${Date.now() - t3} ms)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
