/**
 * Two closing chores for the credit system — READ-ONLY unless `--apply`.
 *
 * 1. TURN OFF `periodic_free_refresh`.
 *    The admin shows it active at 10 credits a week. Nothing anywhere
 *    delivers it — there is no cron, no task, no consumer. Leaving it on
 *    means the product promises something it does not do. Switching the
 *    policy off makes the admin tell the truth; building the feature is a
 *    separate decision, and the row keeps its amount so nothing is lost.
 *
 * 2. EXPLAIN THE LEGACY BALANCES.
 *    Seven accounts hold credits with no ledger rows to account for them —
 *    seeded by hand in May 2026, before the ledger discipline existed. So
 *    "every balance is explained by the ledger" cannot be enforced as an
 *    invariant, which is a shame because it is the strongest check we
 *    have.
 *
 *    This writes one `admin_adjust` ledger entry per affected user for
 *    exactly the unexplained amount, pointing at the lot that already
 *    holds those credits.
 *
 *    ⚠️ IT DOES NOT CHANGE A SINGLE BALANCE. No user gains or loses a
 *    credit; nothing is granted or revoked. It only writes down where
 *    credits that ALREADY EXIST came from, so the ledger stops having a
 *    hole in it. After this, `verify-credit-integrity` can run without
 *    `--allow-legacy-drift` and that invariant is enforced for good.
 *
 * SAFETY
 *   - `--apply` required; dry run by default.
 *   - INSERT and one UPDATE to `grant_policies` only. No DELETE, no DDL.
 *   - `users` is never written. Balances physically cannot move.
 *   - Idempotent: a second run finds no drift and no active policy.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/finalize-credit-legacy.ts
 *   DATABASE_URL=... pnpm tsx scripts/finalize-credit-legacy.ts --apply
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);
const q = <T = Record<string, unknown>>(s: string) =>
  sql(Object.assign([s], { raw: [s] }) as unknown as TemplateStringsArray) as unknown as Promise<T[]>;

async function main() {
  const host = new URL(url!.replace('postgresql://', 'https://')).hostname;
  console.log(`Target: ${host}`);
  console.log(apply ? 'Mode:   APPLY\n' : 'Mode:   DRY RUN (pass --apply to write)\n');

  // ── 1. periodic_free_refresh ─────────────────────────────────────
  const policy = await q<{ kind: string; is_active: boolean; amount: number }>(
    `SELECT kind, is_active, amount FROM grant_policies WHERE kind = 'periodic_free_refresh'`,
  );
  if (policy.length === 0) {
    console.log('1. periodic_free_refresh — no such policy, nothing to do');
  } else if (!policy[0]!.is_active) {
    console.log('1. periodic_free_refresh — already inactive');
  } else {
    console.log(
      `1. periodic_free_refresh — active at ${policy[0]!.amount}cr/week with NO consumer → switching off`,
    );
    if (apply) {
      await q(`UPDATE grant_policies SET is_active = false, updated_at = now()
               WHERE kind = 'periodic_free_refresh'`);
      const after = await q<{ is_active: boolean }>(
        `SELECT is_active FROM grant_policies WHERE kind = 'periodic_free_refresh'`,
      );
      console.log(`   ${after[0]!.is_active === false ? '✓ off' : '✗ still active'}`);
    }
  }

  // ── 2. legacy balances ───────────────────────────────────────────
  const drifted = await q<{
    id: string;
    email: string;
    credits_balance: number;
    ledger_sum: number;
    diff: number;
  }>(`
    SELECT u.id, u.email, u.credits_balance,
           COALESCE(SUM(cl.delta), 0)::int AS ledger_sum,
           (u.credits_balance - COALESCE(SUM(cl.delta), 0))::int AS diff
    FROM users u
    LEFT JOIN credit_ledger cl ON cl.user_id = u.id
    GROUP BY u.id, u.email, u.credits_balance
    HAVING u.credits_balance <> COALESCE(SUM(cl.delta), 0)
    ORDER BY u.email`);

  console.log(`\n2. balances with no ledger explanation: ${drifted.length}`);
  if (drifted.length === 0) {
    console.log('   nothing to reconcile');
  }

  for (const u of drifted) {
    console.log(
      `   ${String(u.email).slice(0, 38).padEnd(40)} balance=${u.credits_balance} ledger=${u.ledger_sum} → write a ${u.diff > 0 ? '+' : ''}${u.diff} entry`,
    );
    if (!apply) continue;

    // Attach to a lot the user actually holds, so the entry points at real
    // credits rather than dangling. Any lot of theirs will do — this is a
    // bookkeeping entry, not a movement.
    const lot = await q<{ id: string; class: string }>(
      `SELECT id, class FROM credit_lots WHERE user_id = '${u.id}'::uuid
       ORDER BY amount_remaining DESC LIMIT 1`,
    );

    await q(`
      INSERT INTO credit_ledger (user_id, delta, reason, balance_after, bucket, lot_id, note, metadata)
      VALUES (
        '${u.id}'::uuid, ${u.diff}, 'admin_adjust'::credit_reason, ${u.credits_balance},
        ${lot.length > 0 ? `'${lot[0]!.class}'` : 'NULL'},
        ${lot.length > 0 ? `'${lot[0]!.id}'::uuid` : 'NULL'},
        'Backfill: credits granted by hand during testing, before the ledger existed. Balance unchanged.',
        jsonb_build_object('legacyBackfill', true, 'balanceAtBackfill', ${u.credits_balance})
      )`);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to write.');
    return;
  }

  // Prove it: the invariant should now hold, and no balance moved.
  const left = await q<{ n: number }>(`
    SELECT COUNT(*)::int n FROM (
      SELECT u.id FROM users u
      LEFT JOIN credit_ledger cl ON cl.user_id = u.id
      GROUP BY u.id, u.credits_balance
      HAVING u.credits_balance <> COALESCE(SUM(cl.delta), 0)
    ) x`);
  const totals = await q<{ balance: number }>(
    `SELECT COALESCE(SUM(credits_balance), 0)::int AS balance FROM users`,
  );
  console.log(`\ntotal credits across all users: ${totals[0]!.balance}`);
  if (left[0]!.n === 0) {
    console.log('✔ every balance is now explained by the ledger');
    console.log('  verify-credit-integrity can drop --allow-legacy-drift from here on');
  } else {
    console.log(`✗ ${left[0]!.n} user(s) still unexplained`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
