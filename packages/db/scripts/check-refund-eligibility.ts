/**
 * "Should I refund this customer?" — answered before you click Refund in
 * Stripe.
 *
 * WHY THIS EXISTS AS A SCRIPT
 *   Refunds are issued by a human in the Stripe dashboard. Our code only
 *   hears about one afterwards, by which time the money has moved and the
 *   only remaining question is how much to claw back. So the ONE moment
 *   the policy can actually be enforced is before that click — and this
 *   is what makes the answer available at that moment, instead of asking
 *   someone to reason it out while looking at an unhappy customer.
 *
 *   It reads the same `evaluateSubscriptionRefund` the webhook does, so
 *   the answer here and the label written into the ledger can never
 *   disagree.
 *
 * Read-only. It changes nothing, ever.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/check-refund-eligibility.ts <email>
 */

import { neon } from '@neondatabase/serverless';

import {
  SUBSCRIPTION_REFUND_WINDOW_DAYS,
  evaluateSubscriptionRefund,
} from '@clickfy/types';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const email = process.argv[2]?.toLowerCase();
if (!email) {
  console.error('Usage: pnpm tsx scripts/check-refund-eligibility.ts <email>');
  process.exit(1);
}

const sql = neon(dbUrl);

interface UserRow {
  id: string;
  email: string;
  entitlement: string;
  credits_balance: number;
  subscription_credits: number;
  topup_credits: number;
  subscription_platform: string | null;
}

interface LotRow {
  id: string;
  class: string;
  amount_granted: number;
  amount_remaining: number;
  created_at: string;
  source_ref: string | null;
}

async function main() {
  const users = (await sql`
    SELECT id, email, entitlement, credits_balance, subscription_credits,
           topup_credits, subscription_platform
      FROM users WHERE lower(email) = ${email}`) as unknown as UserRow[];

  const user = users[0];
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }

  console.log(`\n${user.email}`);
  console.log(
    `  plan ${user.entitlement}${user.subscription_platform ? ` via ${user.subscription_platform}` : ''}` +
      `  ·  ${user.credits_balance.toLocaleString()} credits ` +
      `(${user.subscription_credits.toLocaleString()} plan / ${user.topup_credits.toLocaleString()} top-up)`,
  );

  const subLots = (await sql`
    SELECT id, class, amount_granted, amount_remaining, created_at, source_ref
      FROM credit_lots
     WHERE user_id = ${user.id}::uuid AND class = 'subscription'
     ORDER BY created_at DESC LIMIT 1`) as unknown as LotRow[];

  const lot = subLots[0];
  const verdict = evaluateSubscriptionRefund(
    lot
      ? {
          amountGranted: lot.amount_granted,
          amountRemaining: lot.amount_remaining,
          createdAt: new Date(lot.created_at),
        }
      : null,
  );

  console.log('\n── SUBSCRIPTION ──────────────────────────────────────');
  if (lot) {
    console.log(`  granted   ${lot.amount_granted.toLocaleString()} credits on ${lot.created_at.slice(0, 10)}`);
    console.log(`  remaining ${lot.amount_remaining.toLocaleString()}`);
    console.log(`  spent     ${verdict.creditsUsed.toLocaleString()}`);
    console.log(`  age       ${verdict.daysSinceGrant} day(s)  (window: ${SUBSCRIPTION_REFUND_WINDOW_DAYS})`);
  }
  console.log(`\n  ${verdict.eligible ? '✅ REFUND OK' : '❌ DO NOT REFUND'}`);
  console.log(`  ${verdict.summary}`);
  if (!verdict.eligible) {
    console.log(
      '\n  Refunding anyway is possible but goes against policy. The webhook\n' +
        '  will still reclaim what credits remain and will LABEL the ledger\n' +
        '  entry `againstPolicy: true` so it stays findable.',
    );
  }

  const topLots = (await sql`
    SELECT id, class, amount_granted, amount_remaining, created_at, source_ref
      FROM credit_lots
     WHERE user_id = ${user.id}::uuid AND class = 'topup' AND amount_remaining > 0
     ORDER BY created_at DESC`) as unknown as LotRow[];

  console.log('\n── TOP-UPS ───────────────────────────────────────────');
  console.log('  ❌ NON-REFUNDABLE by policy — credits are delivered and');
  console.log('     spendable immediately, so there is no unused state to');
  console.log('     return to.');
  if (topLots.length > 0) {
    const held = topLots.reduce((n, l) => n + l.amount_remaining, 0);
    console.log(`\n  ${topLots.length} live pack(s), ${held.toLocaleString()} credits still held:`);
    for (const l of topLots) {
      console.log(
        `    ${l.created_at.slice(0, 10)}  ${l.amount_remaining.toLocaleString()} of ` +
          `${l.amount_granted.toLocaleString()} left`,
      );
    }
  } else {
    console.log('\n  No live top-up packs.');
  }
  console.log('');
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
