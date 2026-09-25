/**
 * Mirror Stripe's booked cancellations into `users.subscription_cancels_at`.
 *
 * WHY
 *   Migration 0040 added the column; the webhook fills it from now on.
 *   Cancellations booked BEFORE that (four on 2026-09-24, all through the
 *   Customer Portal) produced no new event, so this reads every live
 *   Stripe subscription once and writes the end date for the ones that
 *   are ending — and clears it for any that are not.
 *
 * WHAT IT TOUCHES
 *   Exactly one column, `subscription_cancels_at`, on users whose
 *   `stripe_customer_id` owns a live subscription. Nothing else. No credit
 *   column, no entitlement, no Stripe write (GET only).
 *
 * Usage (from packages/db):
 *   DATABASE_URL=… STRIPE_SECRET_KEY=… pnpm tsx scripts/sync-stripe-cancellations.ts          # plan only
 *   DATABASE_URL=… STRIPE_SECRET_KEY=… pnpm tsx scripts/sync-stripe-cancellations.ts --apply
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
const key = process.env.STRIPE_SECRET_KEY;
if (!url || !key) {
  console.error('DATABASE_URL and STRIPE_SECRET_KEY are required');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);

interface StripeSub {
  id: string;
  customer: string;
  status: string;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  items: { data: Array<{ current_period_end: number }> };
}

async function listSubscriptions(): Promise<StripeSub[]> {
  const out: StripeSub[] = [];
  let after: string | null = null;
  for (;;) {
    const qs = new URLSearchParams({ status: 'all', limit: '100' });
    if (after) qs.set('starting_after', after);
    const res = await fetch(`https://api.stripe.com/v1/subscriptions?${qs}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` },
    });
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${await res.text()}`);
    const page = (await res.json()) as { data: StripeSub[]; has_more: boolean };
    out.push(...page.data);
    if (!page.has_more) break;
    after = page.data[page.data.length - 1]!.id;
  }
  return out;
}

const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

function endsAt(s: StripeSub): Date | null {
  if (typeof s.cancel_at === 'number') return new Date(s.cancel_at * 1000);
  const pe = s.items?.data?.[0]?.current_period_end;
  if (s.cancel_at_period_end && typeof pe === 'number') return new Date(pe * 1000);
  return null;
}

async function main() {
  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — sync Stripe cancellations → users.subscription_cancels_at`);
  console.log(`database: ${new URL(url!).host}  stripe: ${key!.startsWith('sk_live_') || key!.startsWith('rk_live_') ? 'LIVE' : 'test'}\n`);

  const subs = (await listSubscriptions()).filter((s) => LIVE.has(s.status));
  const byCustomer = new Map<string, StripeSub>();
  for (const s of subs) if (!byCustomer.has(s.customer)) byCustomer.set(s.customer, s);

  const users = (await sql`
    SELECT id, email, stripe_customer_id, subscription_platform, subscription_cancels_at::text
    FROM users
    WHERE stripe_customer_id IS NOT NULL AND is_deleted = false
  `) as Array<{ id: string; email: string; stripe_customer_id: string; subscription_platform: string | null; subscription_cancels_at: string | null }>;

  const changes: Array<{ id: string; email: string; from: string | null; to: Date | null; sub: string }> = [];
  for (const u of users) {
    const s = byCustomer.get(u.stripe_customer_id);
    if (!s) continue;
    const want = endsAt(s);
    const have = u.subscription_cancels_at ? new Date(u.subscription_cancels_at) : null;
    if ((want?.getTime() ?? null) !== (have?.getTime() ?? null)) {
      changes.push({ id: u.id, email: u.email, from: u.subscription_cancels_at, to: want, sub: s.id });
    }
  }

  console.log(`${subs.length} live subscriptions, ${users.length} users with a Stripe customer, ${changes.length} to update\n`);
  for (const c of changes) {
    console.log(`  ${c.email.padEnd(32)} ${c.sub}  ${c.from ?? '∅'} → ${c.to?.toISOString() ?? '∅'}`);
  }
  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }
  for (const c of changes) {
    await sql`UPDATE users SET subscription_cancels_at = ${c.to ? c.to.toISOString() : null}::timestamptz WHERE id = ${c.id}::uuid`;
  }
  console.log(`\nWritten: ${changes.length} row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
