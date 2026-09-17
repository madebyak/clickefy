/**
 * Comp two accounts a one-year Ultimate plan — September 2026.
 *
 * Both carry an entitlement won from a SANDBOX Stripe purchase. In live
 * mode those subscriptions do not exist, so nothing would ever renew them
 * and nothing would ever cancel them: they would simply keep a paid tier
 * forever, for reasons no future reader could reconstruct. This replaces
 * that accident with a deliberate, dated grant.
 *
 * WHAT A COMPED YEAR IS, MECHANICALLY
 *   entitlement `ultimate` + `subscription_expires_at` one year out. The
 *   credits then arrive by themselves: `refresh-subscription-credits`
 *   (jobs-worker, 04:00 UTC) grants the tier's allowance whenever the
 *   newest subscription lot is more than 30 days old and the subscription
 *   has not expired. That is the same path a paying yearly subscriber
 *   takes — 990 credits every 30 days, not 11,880 on day one — so a comp
 *   needs no special case anywhere in the system, and it stops on its own
 *   when the year is up.
 *
 * WHY THE STRIPE FIELDS ARE CLEARED
 *   `subscription_platform = 'stripe'` makes Settings offer a "manage
 *   subscription" button that opens the Stripe portal, and the stored
 *   `cus_…` is a sandbox id that does not resolve against live keys. A
 *   comp has no Stripe subscription behind it, so it should not claim one:
 *   the button disappears, the reconcile sweep skips them (it only
 *   examines Stripe-platform rows), and if either of them ever wants to
 *   subscribe for real, checkout creates a fresh customer.
 *
 * The first period is granted immediately rather than waiting for the
 * refresh task, so the year starts today rather than whenever their last
 * sandbox lot happens to age out. `source_ref` makes that grant
 * idempotent: running this twice grants once.
 *
 * Existing unspent credits are left alone. They expire on their own
 * schedule, and taking them back would be a worse outcome than the small
 * overlap.
 *
 * SAFETY
 *   - Targets two named email addresses. No pattern, no audience.
 *   - UPDATE and INSERT only. No DELETE, no TRUNCATE, no DDL.
 *   - `--apply` required; dry run prints the before/after.
 *   - Refuses if an address does not resolve to exactly one live user.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/comp-ultimate-2026-09.ts
 *   DATABASE_URL=... pnpm tsx scripts/comp-ultimate-2026-09.ts --apply
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

const RECIPIENTS = ['ahmedsam779@gmail.com', 'usamaalsharqi@gmail.com'];
const TIER = 'ultimate';
const YEARS = 1;
/** Stable per grant, so a second run inserts nothing. */
const SOURCE_REF = 'comp:ultimate:2026-09-17';
const NOTE = 'Comped 1-year Ultimate plan (replaces a sandbox-era entitlement)';

interface UserRow {
  id: string;
  email: string;
  entitlement: string;
  credits_balance: number;
  subscription_platform: string | null;
  subscription_expires_at: string | null;
  stripe_customer_id: string | null;
}

async function main() {
  const [plan] = await q<{ credits_per_period: number }>(
    `SELECT credits_per_period FROM plans WHERE tier = '${TIER}' AND is_active = true LIMIT 1`,
  );
  if (!plan) {
    console.error(`Refusing to run — no active '${TIER}' plan in the catalogue.`);
    process.exit(1);
  }
  const allowance = Number(plan.credits_per_period);

  const list = RECIPIENTS.map((e) => `'${e}'`).join(', ');
  const rows = await q<UserRow>(`
    SELECT id, email, entitlement, credits_balance, subscription_platform,
           subscription_expires_at::text, stripe_customer_id
    FROM users WHERE email IN (${list}) AND is_deleted = false`);

  const missing = RECIPIENTS.filter((e) => !rows.some((r) => r.email === e));
  if (missing.length > 0) {
    console.error(`Refusing to run — no live user for: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (rows.length !== RECIPIENTS.length) {
    console.error(`Refusing to run — ${rows.length} rows for ${RECIPIENTS.length} addresses.`);
    process.exit(1);
  }

  const expiresAt = new Date();
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + YEARS);
  // The first period only. The refresh task supplies the other eleven.
  const creditsExpireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — comp ${YEARS}-year ${TIER}`);
  console.log(`database: ${new URL(url!).host}`);
  console.log(`allowance: ${allowance} credits per 30 days, until ${expiresAt.toISOString().slice(0, 10)}\n`);
  for (const r of rows) {
    console.log(` ${r.email}`);
    console.log(`   entitlement   ${r.entitlement} → ${TIER}`);
    console.log(`   expires       ${r.subscription_expires_at?.slice(0, 10) ?? '—'} → ${expiresAt.toISOString().slice(0, 10)}`);
    console.log(`   platform      ${r.subscription_platform ?? '—'} → (none: comped, not a Stripe subscription)`);
    console.log(`   stripe cust   ${r.stripe_customer_id ?? '—'} → cleared (sandbox id, invalid on live keys)`);
    console.log(`   balance       ${r.credits_balance} → ${Number(r.credits_balance) + allowance}`);
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  for (const r of rows) {
    await sql`
      UPDATE users
         SET entitlement = ${TIER}::entitlement,
             subscription_platform = NULL,
             subscription_product_id = NULL,
             subscription_renews_at = ${expiresAt.toISOString()}::timestamptz,
             subscription_expires_at = ${expiresAt.toISOString()}::timestamptz,
             stripe_customer_id = NULL
       WHERE id = ${r.id}::uuid`;

    // The first period, granted exactly as a renewal would grant it:
    // one lot, the bucket columns bumped from it, one ledger row.
    await sql`
      WITH new_lot AS (
        INSERT INTO credit_lots (
          user_id, class, kind, amount_granted, amount_remaining,
          expires_at, source_platform, source_ref
        )
        VALUES (
          ${r.id}::uuid, 'subscription', 'subscription',
          ${allowance}::int, ${allowance}::int,
          ${creditsExpireAt.toISOString()}::timestamptz, NULL, ${SOURCE_REF}
        )
        ON CONFLICT (user_id, kind, source_ref) WHERE source_ref IS NOT NULL
        DO NOTHING
        RETURNING id, class, amount_granted
      ),
      bumped AS (
        UPDATE users u
           SET subscription_credits = u.subscription_credits + nl.amount_granted,
               credits_balance = u.credits_balance + nl.amount_granted
          FROM new_lot nl
         WHERE u.id = ${r.id}::uuid
         RETURNING u.credits_balance AS new_balance
      )
      INSERT INTO credit_ledger (user_id, delta, reason, balance_after, bucket, lot_id, note, metadata)
      SELECT ${r.id}::uuid, nl.amount_granted, 'subscription_grant'::credit_reason,
             b.new_balance, nl.class, nl.id, ${NOTE},
             ${JSON.stringify({ comp: true, tier: TIER, years: YEARS, sourceRef: SOURCE_REF })}::jsonb
        FROM new_lot nl, bumped b`;

    console.log(`  ✓ ${r.email}`);
  }

  console.log('\nWritten. Verify with: pnpm tsx scripts/verify-credit-integrity.ts');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
