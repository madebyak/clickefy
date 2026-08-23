/**
 * Credit-system integrity checker — READ ONLY.
 *
 * The money system has several invariants that are true by construction in
 * the code but can only be *proved* against real data. This asserts all of
 * them and exits non-zero on any failure, so it can gate CI and be run
 * before and after every migration or backfill.
 *
 * Checks:
 *   1. users.credits_balance = promo + subscription + topup
 *      (the 0015 CHECK, re-asserted — a constraint can be dropped)
 *   2. each bucket column = SUM(amount_remaining) of that class's lots
 *      (the lots ARE the truth; the columns are a projection of them)
 *   3. SUM(credit_ledger.delta) per user = credits_balance
 *      (every credit that exists was issued by something we recorded)
 *   4. no lot violates its own bounds
 *   5. no (job_id, bucket) refund appears twice
 *   6. every failed job with a refundable error code has a refund
 *   7. no negative balances or buckets anywhere
 *
 * Check 3 is expected to fail for the 7 legacy accounts seeded by hand in
 * May 2026, before the ledger discipline existed. `--allow-legacy-drift`
 * downgrades that specific case to a warning so the other checks can gate
 * CI in the meantime; remove the flag once those rows are backfilled.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/verify-credit-integrity.ts
 *   DATABASE_URL=... pnpm tsx scripts/verify-credit-integrity.ts --allow-legacy-drift
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const allowLegacyDrift = process.argv.includes('--allow-legacy-drift');
const sql = neon(url);
const q = <T = Record<string, unknown>>(s: string) =>
  sql(Object.assign([s], { raw: [s] }) as unknown as TemplateStringsArray) as unknown as Promise<T[]>;

let failures = 0;
let warnings = 0;

function report(ok: boolean, label: string, detail?: string, asWarning = false) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    return;
  }
  if (asWarning) {
    warnings += 1;
    console.log(`  ⚠ ${label}${detail ? ` — ${detail}` : ''}`);
    return;
  }
  failures += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const host = new URL(url!.replace('postgresql://', 'https://')).hostname;
  console.log(`Credit integrity check — ${host}\n`);

  const hasLots =
    ((await q<{ n: number }>(
      `select count(*)::int n from information_schema.tables where table_name='credit_lots'`,
    ))[0]?.n ?? 0) > 0;

  // ── 1. balance = sum of buckets ────────────────────────────────────
  const c1 = await q<{ n: number }>(`
    select count(*)::int n from users
    where credits_balance <> promo_credits + subscription_credits + topup_credits`);
  report(c1[0]!.n === 0, 'balance equals the sum of its buckets', `${c1[0]!.n} user(s) off`);

  const constraint = await q<{ conname: string }>(
    `select conname from pg_constraint where conname = 'users_balance_matches_buckets'`,
  );
  report(constraint.length > 0, 'the balance/bucket CHECK constraint is still installed');

  // ── 2. buckets = sum of their lots ─────────────────────────────────
  if (hasLots) {
    const c2 = await q<{ n: number }>(`
      select count(*)::int n from users u
      left join (
        select user_id,
          coalesce(sum(amount_remaining) filter (where class='promo'), 0)        p,
          coalesce(sum(amount_remaining) filter (where class='subscription'), 0) s,
          coalesce(sum(amount_remaining) filter (where class='topup'), 0)        t
        from credit_lots group by user_id
      ) l on l.user_id = u.id
      where u.promo_credits        <> coalesce(l.p, 0)
         or u.subscription_credits <> coalesce(l.s, 0)
         or u.topup_credits        <> coalesce(l.t, 0)`);
    report(c2[0]!.n === 0, 'every bucket column matches the sum of its lots', `${c2[0]!.n} user(s) off`);
  } else {
    report(false, 'credit_lots table exists', 'migration 0029 has not been applied here');
  }

  // ── 3. ledger reconciles to balance ────────────────────────────────
  const c3 = await q<{ email: string; credits_balance: number; ledger_sum: number; diff: number }>(`
    select u.email, u.credits_balance, coalesce(sum(cl.delta),0)::int ledger_sum,
           (u.credits_balance - coalesce(sum(cl.delta),0))::int diff
    from users u left join credit_ledger cl on cl.user_id = u.id
    group by u.id, u.email, u.credits_balance
    having u.credits_balance <> coalesce(sum(cl.delta),0)
    order by abs(u.credits_balance - coalesce(sum(cl.delta),0)) desc`);
  report(
    c3.length === 0,
    'every balance is explained by the ledger',
    `${c3.length} user(s) drift, ${c3.reduce((n, r) => n + Math.abs(r.diff), 0)}cr unaccounted`,
    allowLegacyDrift,
  );
  if (c3.length > 0 && c3.length <= 12) {
    for (const r of c3) {
      console.log(`      ${String(r.email).slice(0, 38).padEnd(40)} balance=${r.credits_balance} ledger=${r.ledger_sum} diff=${r.diff > 0 ? '+' : ''}${r.diff}`);
    }
  }

  // ── 4. lot bounds ──────────────────────────────────────────────────
  if (hasLots) {
    const c4 = await q<{ n: number }>(`
      select count(*)::int n from credit_lots
      where amount_remaining < 0 or amount_remaining > amount_granted or amount_granted <= 0`);
    report(c4[0]!.n === 0, 'no lot is outside its own bounds', `${c4[0]!.n} bad lot(s)`);

    const c4b = await q<{ n: number }>(`
      select count(*)::int n from credit_lots
      where (paused_at is null) <> (remaining_lifetime is null)
         or (paused_at is not null and expires_at is not null)`);
    report(c4b[0]!.n === 0, 'no lot is in a half-paused state', `${c4b[0]!.n} incoherent lot(s)`);
  }

  // ── 5. no double refunds ───────────────────────────────────────────
  const c5 = await q<{ n: number }>(`
    select count(*)::int n from (
      select job_id, bucket from credit_ledger
      where reason = 'refund' group by 1,2 having count(*) > 1
    ) x`);
  report(c5[0]!.n === 0, 'no job was refunded twice into the same bucket', `${c5[0]!.n} duplicate(s)`);

  const idx = await q<{ indexname: string }>(`
    select indexname from pg_indexes
    where tablename = 'credit_ledger' and indexname = 'credit_ledger_refund_unique_idx'`);
  report(idx.length > 0, 'the refund idempotency index is still installed');

  // ── 6. refundable failures were refunded ───────────────────────────
  const c6 = await q<{ id: string; code: string; charged: number }>(`
    select j.id, j.error->>'code' code,
      coalesce((select sum(-delta) from credit_ledger where job_id = j.id and reason='job_charge'),0)::int charged
    from jobs j
    where j.status = 'failed'
      and j.error->>'code' in ('provider_error','provider_timeout','r2_input_missing','internal_error')
      and not exists (select 1 from credit_ledger where job_id = j.id and reason = 'refund')
      and coalesce((select sum(-delta) from credit_ledger where job_id = j.id and reason='job_charge'),0) > 0`);
  report(
    c6.length === 0,
    'every refundable failure was actually refunded',
    `${c6.length} job(s) owed ${c6.reduce((n, r) => n + r.charged, 0)}cr`,
  );
  for (const r of c6.slice(0, 10)) console.log(`      ${r.id} ${r.code} ${r.charged}cr`);

  // ── 7. nothing negative ────────────────────────────────────────────
  const c7 = await q<{ n: number }>(`
    select count(*)::int n from users
    where credits_balance < 0 or promo_credits < 0 or subscription_credits < 0 or topup_credits < 0`);
  report(c7[0]!.n === 0, 'no negative balance or bucket anywhere', `${c7[0]!.n} user(s)`);

  console.log(
    `\n${failures === 0 ? '✔ all invariants hold' : `✗ ${failures} invariant(s) VIOLATED`}` +
      (warnings > 0 ? `  (${warnings} warning(s) suppressed by --allow-legacy-drift)` : ''),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nCheck failed to run:', err);
  process.exit(1);
});
