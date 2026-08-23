/**
 * Create the Stripe products and prices for our plan catalogue, and write
 * the resulting ids into `plan_products`.
 *
 * WHY PROGRAMMATICALLY
 *   Eight prices typed by hand into a dashboard, then transcribed back
 *   into a database, is eight chances to fumble an identifier. And a
 *   fumbled identifier is not a cosmetic bug: the webhook looks a plan up
 *   BY that id, so a wrong one means a customer pays and receives nothing
 *   until someone notices. Production already carries the scars of
 *   hand-entered placeholders (`weekly`, `Pack-ultimate`).
 *
 * IDEMPOTENCY
 *   Prices are found by `lookup_key` (`clickefy_<tier>_<interval>`), which
 *   is Stripe's own mechanism for exactly this. Products are found by a
 *   `clickefy_tier` metadata tag. Re-running finds and reuses; it never
 *   creates a second copy.
 *
 *   Stripe prices are IMMUTABLE — you cannot edit an amount. Changing a
 *   price means creating a new one and moving the lookup_key across, which
 *   this script does explicitly rather than silently, because a price
 *   change is a decision and should read like one in the output.
 *
 * SAFETY
 *   - `--apply` required; dry run by default.
 *   - Refuses to run against a live key. Sandbox/test only until someone
 *     deliberately passes `--live`.
 *   - Never deletes anything in Stripe. Superseded prices are deactivated,
 *     which preserves every existing subscription billing against them.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=... DATABASE_URL=... pnpm tsx scripts/sync-stripe-prices.ts
 *   STRIPE_SECRET_KEY=... DATABASE_URL=... pnpm tsx scripts/sync-stripe-prices.ts --apply
 */

import { neon } from '@neondatabase/serverless';
import Stripe from 'stripe';

const dbUrl = process.env.DATABASE_URL;
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!dbUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
if (!stripeKey) {
  console.error('STRIPE_SECRET_KEY is not set');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const allowLive = process.argv.includes('--live');

// A live key here would create real, purchasable products. Require an
// explicit flag rather than trusting whatever happens to be in the env.
if (stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_')) {
  if (!allowLive) {
    console.error(
      'Refusing to run: this is a LIVE Stripe key. Pass --live if that is genuinely intended.',
    );
    process.exit(1);
  }
  console.log('⚠️  Running against LIVE Stripe.\n');
}

const stripe = new Stripe(stripeKey);
const sql = neon(dbUrl);
const q = <T = Record<string, unknown>>(s: string) =>
  sql(Object.assign([s], { raw: [s] }) as unknown as TemplateStringsArray) as unknown as Promise<T[]>;

/**
 * Display price per tier, in cents.
 *
 * Yearly is two months free — the customer pays for ten. Stripe bills the
 * yearly amount once; our own 30-day refresh is what keeps the CREDIT
 * allowance monthly, so a yearly subscriber cannot draw a year of credits
 * on day one.
 */
const PRICE_CENTS: Record<string, { month: number; year: number }> = {
  basic: { month: 1_900, year: 19_000 },
  creator: { month: 3_900, year: 39_000 },
  pro: { month: 7_500, year: 75_000 },
  ultimate: { month: 9_900, year: 99_000 },
};

const TIER_LABEL: Record<string, string> = {
  basic: 'Basic',
  creator: 'Creator',
  pro: 'Pro',
  ultimate: 'Ultimate',
};

const CURRENCY = 'usd';

interface PlanRow {
  id: string;
  tier: string;
  interval: string;
  credits_per_period: number;
  display_name: string;
}

/** One Stripe Product per TIER; the two intervals are prices on it. */
async function findOrCreateProduct(tier: string): Promise<Stripe.Product> {
  const found = await stripe.products.search({
    query: `metadata['clickefy_tier']:'${tier}'`,
    limit: 1,
  });
  if (found.data[0]) return found.data[0];

  if (!apply) {
    return { id: `(would create product for ${tier})` } as Stripe.Product;
  }
  return stripe.products.create({
    name: `Clickefy ${TIER_LABEL[tier] ?? tier}`,
    description: `Clickefy ${TIER_LABEL[tier] ?? tier} plan`,
    metadata: { clickefy_tier: tier },
  });
}

async function main() {
  const mode = stripeKey!.includes('_test_') ? 'SANDBOX/TEST' : 'LIVE';
  console.log(`Stripe: ${mode}`);
  console.log(apply ? 'Mode:   APPLY\n' : 'Mode:   DRY RUN (pass --apply to write)\n');

  const plans = await q<PlanRow>(
    `SELECT id, tier, interval, credits_per_period, display_name
     FROM plans WHERE is_active = true ORDER BY display_order`,
  );
  if (plans.length === 0) {
    console.log('No active plans — run seed-plans-catalog.ts first.');
    return;
  }

  console.log(
    `${'tier'.padEnd(10)}${'interval'.padEnd(9)}${'amount'.padStart(9)}  ${'lookup_key'.padEnd(26)}action`,
  );
  console.log('─'.repeat(80));

  let created = 0;
  let reused = 0;
  let linked = 0;

  for (const plan of plans) {
    const cents = PRICE_CENTS[plan.tier]?.[plan.interval as 'month' | 'year'];
    if (cents === undefined) {
      console.log(`${plan.tier.padEnd(10)}${plan.interval.padEnd(9)}${'—'.padStart(9)}  (no price configured — skipped)`);
      continue;
    }

    const lookupKey = `clickefy_${plan.tier}_${plan.interval}`;
    const product = await findOrCreateProduct(plan.tier);

    // `lookup_key` is Stripe's own idempotent handle for a price.
    const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, active: true });
    let price = existing.data[0];
    let action: string;

    if (price && price.unit_amount === cents && price.currency === CURRENCY) {
      action = 'reuse';
      reused += 1;
    } else if (price) {
      // Prices are immutable in Stripe. A changed amount means minting a
      // new price and moving the lookup_key over. The old one is
      // DEACTIVATED, never deleted — every subscription already billing
      // against it keeps working.
      action = `REPRICE ${(price.unit_amount ?? 0) / 100} → ${cents / 100}`;
      if (apply) {
        await stripe.prices.update(price.id, { lookup_key: `${lookupKey}_old_${Date.now()}`, active: false });
        price = await stripe.prices.create({
          product: product.id,
          currency: CURRENCY,
          unit_amount: cents,
          recurring: { interval: plan.interval as 'month' | 'year' },
          lookup_key: lookupKey,
          metadata: { clickefy_tier: plan.tier, clickefy_interval: plan.interval, clickefy_plan_id: plan.id },
        });
        created += 1;
      }
    } else {
      action = 'create';
      if (apply) {
        price = await stripe.prices.create({
          product: product.id,
          currency: CURRENCY,
          unit_amount: cents,
          recurring: { interval: plan.interval as 'month' | 'year' },
          lookup_key: lookupKey,
          metadata: { clickefy_tier: plan.tier, clickefy_interval: plan.interval, clickefy_plan_id: plan.id },
        });
        created += 1;
      }
    }

    console.log(
      `${plan.tier.padEnd(10)}${plan.interval.padEnd(9)}${('$' + cents / 100).padStart(9)}  ${lookupKey.padEnd(26)}${action}`,
    );

    // Link it. The PRICE id is what a checkout session takes and what a
    // webhook reports, so that — not the product id — is what we store.
    if (apply && price?.id) {
      await q(`
        INSERT INTO plan_products (plan_id, platform, store_product_id, price_usd, is_active)
        VALUES ('${plan.id}'::uuid, 'stripe', '${price.id}', ${cents / 100}, true)
        ON CONFLICT (plan_id, platform) DO UPDATE
          SET store_product_id = EXCLUDED.store_product_id,
              price_usd        = EXCLUDED.price_usd,
              is_active        = true,
              updated_at       = now()`);
      linked += 1;
    }
  }

  if (!apply) {
    console.log('\nRe-run with --apply to create these in Stripe and link them.');
    return;
  }

  console.log(`\n${created} price(s) created, ${reused} reused, ${linked} linked to plans.`);

  const rows = await q<{ tier: string; interval: string; store_product_id: string; price_usd: string }>(`
    SELECT pl.tier, pl."interval", pp.store_product_id, pp.price_usd
    FROM plan_products pp JOIN plans pl ON pl.id = pp.plan_id
    WHERE pp.platform = 'stripe' AND pp.is_active
    ORDER BY pl.display_order`);
  console.log('\nStripe products now linked:');
  for (const r of rows) {
    console.log(`  ${r.tier}/${r.interval}  $${r.price_usd}  ${r.store_product_id}`);
  }
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
