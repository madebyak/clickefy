/**
 * Repair ONE account after the upgrade mis-grant of 2026-09-23.
 *
 * WHAT HAPPENED
 *   huda@moovo.ai upgraded Creator → Ultimate at 08:46 UTC. Stripe moved
 *   the subscription to Ultimate and charged $57.95 (invoice
 *   `in_1UIlpFQvmIgrJttKIDmdMNpr`). Our webhook read the plan from the
 *   invoice's FIRST line — the negative "unused time on Creator" proration
 *   line — and so set her tier back to Creator, recorded the Creator price
 *   as her product, and granted 390 credits where Ultimate is 990.
 *
 *   Stripe: Ultimate, renews 2026-10-22 08:10 UTC at $99.
 *   Us:     Creator, 390 credits.  She is 600 credits short.
 *
 * WHAT THIS DOES (founder's decision 2026-09-23)
 *   - entitlement → ultimate, subscription_product_id → the Ultimate price
 *   - +600 credits on a NEW subscription lot, expiring at her real period
 *     end (2026-10-22 08:10:43 UTC) — the same date the existing 390 lot is
 *     moved to, so both halves of the month expire together
 *   - money untouched; the 22 Oct renewal stays exactly as Stripe plans it
 *   - a `subscription_grant` ledger row explains the +600
 *
 * WHAT IT REFUSES TO DO
 *   - run against any account but the one named below
 *   - run if the row is not in the exact broken state described (already
 *     repaired, or repaired by hand, or the renewal has since landed)
 *   - write anything without `--apply`
 *
 * Everything is ONE statement: lot + projection + ledger + user row move
 * together or not at all, and the lot's `source_ref` makes a second run a
 * no-op.
 *
 * Protocol: backup-money-tables → dry run → --apply → --verify backup →
 * verify-credit-integrity.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/repair-huda-upgrade-2026-09.ts
 *   DATABASE_URL=... pnpm tsx scripts/repair-huda-upgrade-2026-09.ts --apply
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);

const EMAIL = 'huda@moovo.ai';
const USER_ID = 'b08f0173-27d5-4f9e-ab9c-5c2848f4e5dd';
const BROKEN_INVOICE = 'in_1UIlpFQvmIgrJttKIDmdMNpr';
const CREATOR_PRICE = 'price_1UGlzHQvmIgrJttKbseQXDgv';
const ULTIMATE_PRICE = 'price_1UGlzMQvmIgrJttKljxAEF6n';
const ULTIMATE_ALLOWANCE = 990;
const GRANTED_IN_ERROR = 390;
const MISSING = ULTIMATE_ALLOWANCE - GRANTED_IN_ERROR; // 600
/** Her Stripe period end — `users.subscription_expires_at` as written by the webhook. */
const PERIOD_END = '2026-10-22T08:10:43.000Z';
const SOURCE_REF = `repair:${BROKEN_INVOICE}`;

interface UserRow {
  id: string;
  email: string;
  entitlement: string;
  subscription_platform: string | null;
  subscription_product_id: string | null;
  subscription_expires_at: string | null;
  promo_credits: number;
  subscription_credits: number;
  topup_credits: number;
  credits_balance: number;
}
interface LotRow {
  id: string;
  amount_granted: number;
  amount_remaining: number;
  expires_at: string;
  source_ref: string | null;
}

async function main() {
  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — repair ${EMAIL}`);
  console.log(`database: ${new URL(url!).host}\n`);

  const users = (await sql`
    SELECT id, email, entitlement, subscription_platform, subscription_product_id,
           subscription_expires_at::text, promo_credits, subscription_credits,
           topup_credits, credits_balance
    FROM users WHERE id = ${USER_ID}::uuid AND email = ${EMAIL} AND is_deleted = false
  `) as unknown as UserRow[];
  if (users.length !== 1) throw new Error(`expected exactly one live user, found ${users.length}`);
  const u = users[0]!;

  const lots = (await sql`
    SELECT id, amount_granted, amount_remaining, expires_at::text, source_ref
    FROM credit_lots
    WHERE user_id = ${USER_ID}::uuid AND class = 'subscription'
    ORDER BY created_at DESC
  `) as unknown as LotRow[];
  const broken = lots.find((l) => l.source_ref === BROKEN_INVOICE);
  const already = lots.find((l) => l.source_ref === SOURCE_REF);

  console.log('before:');
  console.log(`  entitlement   ${u.entitlement}`);
  console.log(`  product       ${u.subscription_product_id}`);
  console.log(`  expires       ${u.subscription_expires_at}`);
  console.log(`  buckets       promo ${u.promo_credits} / sub ${u.subscription_credits} / topup ${u.topup_credits} = ${u.credits_balance}`);
  console.log(`  broken lot    ${broken ? `${broken.id} ${broken.amount_granted}/${broken.amount_remaining} expires ${broken.expires_at}` : 'NOT FOUND'}`);
  console.log(`  repair lot    ${already ? already.id + ' (ALREADY APPLIED)' : 'none'}`);

  // ── Preconditions: the exact broken state, nothing else ────────────
  const problems: string[] = [];
  if (already) problems.push('repair lot already exists');
  if (u.entitlement !== 'creator') problems.push(`entitlement is ${u.entitlement}, expected creator`);
  if (u.subscription_platform !== 'stripe') problems.push('not a Stripe subscriber');
  if (u.subscription_product_id !== CREATOR_PRICE) problems.push('product is not the Creator price');
  if (!u.subscription_expires_at?.startsWith('2026-10-22 08:10:43')) problems.push(`expires_at is ${u.subscription_expires_at}`);
  if (!broken) problems.push('the mis-granted lot is missing');
  if (broken && broken.amount_granted !== GRANTED_IN_ERROR) problems.push(`broken lot granted ${broken.amount_granted}, expected ${GRANTED_IN_ERROR}`);
  if (u.subscription_credits !== (broken?.amount_remaining ?? -1)) problems.push('subscription bucket does not equal the broken lot — another lot is live');
  if (problems.length) {
    console.log('\nREFUSING — account is not in the expected state:');
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(2);
  }

  console.log('\nafter (planned):');
  console.log(`  entitlement   ultimate`);
  console.log(`  product       ${ULTIMATE_PRICE}`);
  console.log(`  expires       unchanged (${u.subscription_expires_at})`);
  console.log(`  buckets       promo ${u.promo_credits} / sub ${u.subscription_credits + MISSING} / topup ${u.topup_credits} = ${u.credits_balance + MISSING}`);
  console.log(`  new lot       +${MISSING} credits, expires ${PERIOD_END}, source_ref ${SOURCE_REF}`);
  console.log(`  broken lot    expires moved ${broken!.expires_at} → ${PERIOD_END} (same period end)`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  const result = (await sql`
    WITH
      new_lot AS (
        INSERT INTO credit_lots (
          user_id, class, kind, amount_granted, amount_remaining,
          expires_at, source_platform, source_ref
        )
        VALUES (
          ${USER_ID}::uuid, 'subscription', 'subscription',
          ${MISSING}::int, ${MISSING}::int,
          ${PERIOD_END}::timestamptz, 'stripe', ${SOURCE_REF}
        )
        ON CONFLICT (user_id, kind, source_ref) WHERE source_ref IS NOT NULL
        DO NOTHING
        RETURNING id, amount_granted
      ),
      realigned AS (
        UPDATE credit_lots
        SET expires_at = ${PERIOD_END}::timestamptz
        WHERE id = ${broken!.id}::uuid AND EXISTS (SELECT 1 FROM new_lot)
        RETURNING id
      ),
      bumped AS (
        UPDATE users u
        SET entitlement             = 'ultimate',
            subscription_product_id = ${ULTIMATE_PRICE},
            subscription_credits    = u.subscription_credits + nl.amount_granted,
            credits_balance         = u.credits_balance      + nl.amount_granted
        FROM new_lot nl
        WHERE u.id = ${USER_ID}::uuid
          AND u.entitlement = 'creator'
        RETURNING u.credits_balance AS new_balance
      ),
      entry AS (
        INSERT INTO credit_ledger (user_id, delta, reason, balance_after, bucket, lot_id, note, metadata)
        SELECT ${USER_ID}::uuid, nl.amount_granted, 'subscription_grant'::credit_reason,
               b.new_balance, 'subscription', nl.id,
               'Repair: Ultimate upgrade on 23 Sep was granted at the Creator allowance',
               jsonb_build_object(
                 'repair', true, 'tier', 'ultimate', 'interval', 'month',
                 'invoiceId', ${BROKEN_INVOICE}, 'priceId', ${ULTIMATE_PRICE},
                 'allowance', ${ULTIMATE_ALLOWANCE}, 'grantedInError', ${GRANTED_IN_ERROR}
               )
        FROM new_lot nl, bumped b
        RETURNING id
      )
    SELECT nl.amount_granted AS granted, b.new_balance FROM new_lot nl, bumped b
  `) as unknown as Array<{ granted: number; new_balance: number }>;

  if (result.length === 0) throw new Error('nothing written — the lot insert conflicted or the user row did not match');
  console.log(`\nWritten: +${result[0]!.granted} credits, balance now ${result[0]!.new_balance}`);

  const [after] = (await sql`
    SELECT entitlement, subscription_product_id, promo_credits, subscription_credits, topup_credits, credits_balance
    FROM users WHERE id = ${USER_ID}::uuid
  `) as unknown as Array<Record<string, unknown>>;
  console.log('after:', JSON.stringify(after));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
