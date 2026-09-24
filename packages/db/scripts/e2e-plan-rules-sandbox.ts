/**
 * END-TO-END test of the plan-change rules — SANDBOX Stripe + DEV database.
 *
 * Drives a Stripe test clock and lets the REAL webhook handler do the
 * granting: run the local API (`pnpm --filter @clickfy/api dev`) and
 * `stripe listen --forward-to http://localhost:8787/v1/webhooks/stripe`
 * first, with `apps/api/.dev.vars` pointing at the dev branch. Asserts
 * the database after every step.
 *
 * Scenario (the founder's rules of 2026-09-23):
 *   subscribe Basic → spend 100 → UPGRADE to Creator: full $39, cycle
 *   restarts today, 90 carried (480) → book a downgrade → boundary: $19,
 *   wiped to 190 → plain renewal: wiped to 190 → cancel: no invoice,
 *   Free, welcome credits intact → ledger/lots/buckets all reconcile.
 *
 * REFUSES a live key and any database that is not the dev branch. Resets
 * the fixture user's subscription history at the start, so it is
 * re-runnable. First run 2026-09-24: 25/25 passed.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_… DATABASE_URL=<dev branch> pnpm tsx scripts/e2e-plan-rules-sandbox.ts
 */
import Stripe from 'stripe';
import { neon } from '@neondatabase/serverless';

const key = process.env.STRIPE_SECRET_KEY!;
const dbUrl = process.env.DATABASE_URL!;
if (!key.startsWith('sk_test_')) { console.error('REFUSING: not a sandbox key'); process.exit(1); }
if (!dbUrl.includes('ep-polished-heart')) { console.error('REFUSING: not the dev branch'); process.exit(1); }
const stripe = new Stripe(key, { maxNetworkRetries: 2 });
const sql = neon(dbUrl);

const USER_ID = '6703dee1-e723-4bdd-8e9e-42ea9969bcde'; // webtest+clerk_test@example.com (dev)
const BASIC = 'price_1U7hitQxAujizpLIThmHeyRU', CREATOR = 'price_1U7hivQxAujizpLIhNCUZFdD';
const ts = (t?: number | null) => t ? new Date(t * 1000).toISOString().slice(0, 16) : '∅';
let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
async function advance(clockId: string, to: number) {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: to });
  for (;;) { const c = await stripe.testHelpers.testClocks.retrieve(clockId); if (c.status === 'ready') return; if (c.status !== 'advancing') throw new Error('clock ' + c.status); await new Promise(r => setTimeout(r, 1500)); }
}
async function waitProcessed(where: string, timeoutMs = 60000) {
  const t0 = Date.now();
  for (;;) {
    const rows = await sql(`SELECT event_id, event_type, processed_at, processing_error FROM stripe_events WHERE ${where} ORDER BY event_created_at`);
    if (rows.length && rows.every((r: any) => r.processed_at)) return rows;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${where}: ${JSON.stringify(rows)}`);
    await new Promise(r => setTimeout(r, 2000));
  }
}
async function user() {
  const [u] = await sql`SELECT entitlement, subscription_product_id, subscription_expires_at::text, promo_credits, subscription_credits, topup_credits, credits_balance FROM users WHERE id = ${USER_ID}::uuid`;
  return u as any;
}
async function subLots() {
  return (await sql`SELECT amount_granted g, amount_remaining r, expires_at::text expires, source_ref FROM credit_lots WHERE user_id=${USER_ID}::uuid AND class='subscription' ORDER BY created_at`) as any[];
}
async function ledgerTail(n = 4) {
  return (await sql`SELECT delta, reason::text, note, metadata FROM credit_ledger WHERE user_id=${USER_ID}::uuid ORDER BY created_at DESC LIMIT ${n}`) as any[];
}
/** The two rows one rollover writes share a created_at, so find them by reason. */
async function rolloverRows() {
  const rows = await ledgerTail(2);
  return { reset: rows.find((r) => r.reason === 'subscription_reset'), grant: rows.find((r) => r.reason === 'subscription_grant') };
}

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: 'e2e-plan-rules' });
  // Reset the fixture from any earlier run (dev only, guarded above).
  await sql`DELETE FROM stripe_events WHERE user_id = ${USER_ID}::uuid`;
  await sql`DELETE FROM credit_ledger WHERE user_id = ${USER_ID}::uuid AND (bucket = 'subscription' OR reason IN ('subscription_grant','subscription_reset') OR note LIKE 'e2e:%')`;
  await sql`DELETE FROM credit_lots WHERE user_id = ${USER_ID}::uuid AND class = 'subscription'`;
  await sql`UPDATE users SET subscription_credits = 0, credits_balance = promo_credits + topup_credits WHERE id = ${USER_ID}::uuid`;
  await sql`UPDATE users SET entitlement='free', subscription_platform=NULL, subscription_product_id=NULL, subscription_renews_at=NULL, subscription_expires_at=NULL, stripe_customer_id=NULL WHERE id = ${USER_ID}::uuid`;
  const before = await user();
  console.log('fixture before:', before);
  try {
    const cus = await stripe.customers.create({ email: 'webtest+clerk_test@example.com', test_clock: clock.id, payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' }, metadata: { clickefy_user_id: USER_ID } });
    await sql`UPDATE users SET stripe_customer_id = ${cus.id} WHERE id = ${USER_ID}::uuid`;

    console.log('\n== 1. subscribe Basic ==');
    let sub = await stripe.subscriptions.create({ customer: cus.id, items: [{ price: BASIC }], payment_behavior: 'error_if_incomplete', metadata: { clickefy_user_id: USER_ID } });
    let inv = (await stripe.invoices.list({ customer: cus.id, limit: 1 })).data[0]!;
    await waitProcessed(`invoice_id = '${inv.id}' AND event_type = 'invoice.paid'`);
    let u = await user(); let lots = await subLots();
    const periodEnd1 = (sub.items.data[0] as any).current_period_end as number;
    check('entitlement basic', u.entitlement === 'basic', u);
    check('sub bucket 190', u.subscription_credits === 190, u);
    check('promo untouched', u.promo_credits === before.promo_credits, u);
    check('one lot 190, expires at period end', lots.length === 1 && lots[0].g === 190 && lots[0].r === 190 && lots[0].expires.startsWith(new Date(periodEnd1 * 1000).toISOString().slice(0, 16).replace('T', ' ')), { lots, periodEnd: ts(periodEnd1) });
    check('ledger grant carries tier', (await ledgerTail(1))[0].metadata?.tier === 'basic', await ledgerTail(1));

    console.log('\n== 2. spend 100 (direct dev-DB edit), advance 10 days ==');
    await sql`UPDATE credit_lots SET amount_remaining = amount_remaining - 100 WHERE user_id=${USER_ID}::uuid AND class='subscription' AND amount_remaining = 190`;
    await sql`UPDATE users SET subscription_credits = subscription_credits - 100, credits_balance = credits_balance - 100 WHERE id=${USER_ID}::uuid`;
    await sql`INSERT INTO credit_ledger (user_id, delta, reason, balance_after, bucket, note) SELECT id, -100, 'admin_adjust', credits_balance, 'subscription', 'e2e: simulated spend' FROM users WHERE id=${USER_ID}::uuid`;
    await advance(clock.id, now + 10 * 86400);

    console.log('\n== 3. UPGRADE to Creator: full price, anchor reset ==');
    sub = await stripe.subscriptions.retrieve(sub.id);
    sub = await stripe.subscriptions.update(sub.id, { items: [{ id: sub.items.data[0].id, price: CREATOR }], proration_behavior: 'none', billing_cycle_anchor: 'now', payment_behavior: 'error_if_incomplete' });
    inv = (await stripe.invoices.list({ customer: cus.id, limit: 1 })).data[0]!;
    check('upgrade invoice is full $39, one line', inv.amount_paid === 3900 && inv.lines.data.length === 1, { paid: inv.amount_paid, lines: inv.lines.data.length, reason: inv.billing_reason });
    await waitProcessed(`invoice_id = '${inv.id}' AND event_type = 'invoice.paid'`);
    await waitProcessed(`subscription_id = '${sub.id}' AND event_type = 'customer.subscription.updated'`);
    u = await user(); lots = await subLots();
    const periodEnd2 = (sub.items.data[0] as any).current_period_end as number;
    check('entitlement creator', u.entitlement === 'creator', u);
    check('product = creator price', u.subscription_product_id === CREATOR, u);
    check('sub bucket 480 (390 + 90 carried)', u.subscription_credits === 480, u);
    check('balance = promo + 480', u.credits_balance === before.promo_credits + 480, u);
    check('old lot closed, new lot 480 expiring at NEW period end', lots.length === 2 && lots[0].r === 0 && lots[1].g === 480 && lots[1].expires.startsWith(new Date(periodEnd2 * 1000).toISOString().slice(0, 16).replace('T', ' ')), { lots, periodEnd2: ts(periodEnd2) });
    check('expires_at = new period end (renewal moved)', String(u.subscription_expires_at).startsWith(new Date(periodEnd2 * 1000).toISOString().slice(0, 16).replace('T', ' ')), u);
    let rr = await rolloverRows();
    check('ledger: -90 carried reset + 480 grant', rr.reset?.delta === -90 && rr.reset?.metadata?.carried === true && rr.grant?.delta === 480 && rr.grant?.metadata?.decision === 'carry', rr);
    console.log('  stripe_events note:', (await sql`SELECT processing_error FROM stripe_events WHERE invoice_id=${inv.id} AND event_type='invoice.paid'`)[0]);

    console.log('\n== 4. book downgrade to Basic; advance to the boundary ==');
    await advance(clock.id, now + 15 * 86400);
    sub = await stripe.subscriptions.retrieve(sub.id);
    let schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
    const live = schedule.phases[0];
    schedule = await stripe.subscriptionSchedules.update(schedule.id, { end_behavior: 'release', proration_behavior: 'none', phases: [
      { items: [{ price: live.items[0].price as string, quantity: 1 }], start_date: live.start_date, end_date: live.end_date ?? undefined },
      { items: [{ price: BASIC, quantity: 1 }] },
    ] });
    await new Promise(r => setTimeout(r, 4000));
    u = await user();
    check('booking a downgrade changes nothing (still creator, 480)', u.entitlement === 'creator' && u.subscription_credits === 480, u);
    await advance(clock.id, periodEnd2 + 3600);
    inv = (await stripe.invoices.list({ customer: cus.id, limit: 1 })).data[0]!;
    check('boundary invoice $19', inv.amount_paid === 1900, { paid: inv.amount_paid, reason: inv.billing_reason });
    await waitProcessed(`invoice_id = '${inv.id}' AND event_type = 'invoice.paid'`);
    await new Promise(r => setTimeout(r, 3000));
    u = await user(); lots = await subLots();
    sub = await stripe.subscriptions.retrieve(sub.id);
    const periodEnd3 = (sub.items.data[0] as any).current_period_end as number;
    check('entitlement basic', u.entitlement === 'basic', u);
    check('sub bucket 190 (480 wiped)', u.subscription_credits === 190, u);
    check('promo still untouched', u.promo_credits === before.promo_credits, u);
    check('new lot 190 expiring at period end', lots[lots.length - 1].g === 190 && lots[lots.length - 1].expires.startsWith(new Date(periodEnd3 * 1000).toISOString().slice(0, 16).replace('T', ' ')), { lots, periodEnd3: ts(periodEnd3) });
    rr = await rolloverRows();
    check('ledger: -480 forfeited + 190', rr.reset?.delta === -480 && rr.reset?.metadata?.carried === false && rr.grant?.delta === 190 && rr.grant?.metadata?.decision === 'wipe', rr);

    console.log('\n== 5. plain renewal ==');
    await advance(clock.id, periodEnd3 + 3600);
    inv = (await stripe.invoices.list({ customer: cus.id, limit: 1 })).data[0]!;
    await waitProcessed(`invoice_id = '${inv.id}' AND event_type = 'invoice.paid'`);
    await new Promise(r => setTimeout(r, 3000));
    u = await user();
    check('renewal: basic, 190 again (wiped + regranted)', u.entitlement === 'basic' && u.subscription_credits === 190, u);
    rr = await rolloverRows();
    check('ledger: -190 forfeited + 190', rr.reset?.delta === -190 && rr.grant?.delta === 190 && rr.grant?.metadata?.decision === 'wipe', rr);

    console.log('\n== 6. cancel: release schedule, cancel_at_period_end, advance ==');
    sub = await stripe.subscriptions.retrieve(sub.id);
    const schedId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
    if (schedId) await stripe.subscriptionSchedules.release(schedId);
    sub = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
    const periodEnd4 = (sub.items.data[0] as any).current_period_end as number;
    const invCount = (await stripe.invoices.list({ customer: cus.id, limit: 20 })).data.length;
    await advance(clock.id, periodEnd4 + 3600);
    check('no new invoice after cancel', (await stripe.invoices.list({ customer: cus.id, limit: 20 })).data.length === invCount);
    await waitProcessed(`subscription_id = '${sub.id}' AND event_type = 'customer.subscription.deleted'`);
    await new Promise(r => setTimeout(r, 3000));
    u = await user();
    check('free, sub 0, promo intact', u.entitlement === 'free' && u.subscription_credits === 0 && u.promo_credits === before.promo_credits, u);

    // Integrity of the fixture user: buckets == lots, ledger sum == balance
    const [integ] = await sql`SELECT u.credits_balance, u.promo_credits + u.subscription_credits + u.topup_credits AS buckets,
      (SELECT COALESCE(SUM(delta),0) FROM credit_ledger WHERE user_id=u.id)::int AS ledger,
      (SELECT COALESCE(SUM(amount_remaining),0) FROM credit_lots WHERE user_id=u.id AND class='subscription')::int AS sub_lots
      FROM users u WHERE u.id=${USER_ID}::uuid`;
    check('integrity: balance = buckets = ledger sum; sub lots = bucket', (integ as any).credits_balance === (integ as any).buckets && (integ as any).ledger === (integ as any).credits_balance && (integ as any).sub_lots === u.subscription_credits, integ);
  } finally {
    await stripe.testHelpers.testClocks.del(clock.id);
    console.log(`\n(test clock deleted) — ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S)'}`);
  }
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
