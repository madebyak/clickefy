/**
 * Create the Stripe products and ONE-TIME prices for the credit packs,
 * and write the resulting ids into `pack_products`.
 *
 * THE ONE THING THAT DIFFERS FROM PLANS
 *   These prices have no `recurring` block. That single omission is what
 *   makes them one-time purchases, and it is what forces the checkout to
 *   use `mode: 'payment'` instead of `mode: 'subscription'`, which in
 *   turn is why the webhook grants top-ups on
 *   `checkout.session.completed` rather than `invoice.paid`. Get this
 *   wrong and Stripe silently sets up a monthly charge for a credit pack.
 *
 * IDEMPOTENCY
 *   Prices are found by `lookup_key` (`clickefy_<pack key>`), Stripe's own
 *   mechanism for exactly this. Products are found by a `clickefy_pack`
 *   metadata tag. Re-running finds and reuses; it never creates a second
 *   copy.
 *
 *   Stripe prices are IMMUTABLE — you cannot edit an amount. A repricing
 *   mints a new price and moves the lookup_key across, which this does
 *   explicitly rather than silently, because a price change is a decision
 *   and should read like one in the output. The superseded price is
 *   DEACTIVATED, never deleted.
 *
 * SAFETY
 *   - `--apply` required; dry run by default.
 *   - Refuses a live key unless also given `--live`.
 *   - Refuses a ladder that undercuts the best subscription rate.
 *   - Touches no credit column. Balances cannot move.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=... DATABASE_URL=... pnpm tsx scripts/sync-stripe-packs.ts
 *   STRIPE_SECRET_KEY=... DATABASE_URL=... pnpm tsx scripts/sync-stripe-packs.ts --apply
 */

import { neon } from '@neondatabase/serverless';
import Stripe from 'stripe';

import {
  PACKS,
  pricePerCredit,
  totalCredits,
  violatesTierLadder,
  BEST_SUBSCRIPTION_RATE_USD,
} from './pack-catalogue';

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
  sql(Object.assign([s], { raw: [s] }) as unknown as TemplateStringsArray) as unknown as Promise<
    T[]
  >;

const CURRENCY = 'usd';

/** One Stripe Product per pack. */
async function findOrCreateProduct(key: string, name: string): Promise<Stripe.Product> {
  const found = await stripe.products.search({
    query: `metadata['clickefy_pack']:'${key}'`,
    limit: 1,
  });
  if (found.data[0]) return found.data[0];

  if (!apply) return { id: `(would create product for ${key})` } as Stripe.Product;
  return stripe.products.create({
    name: `Clickefy — ${name}`,
    description: `${name} top-up. Credits are added to your balance immediately.`,
    metadata: { clickefy_pack: key },
  });
}

async function main() {
  const mode = stripeKey!.includes('_test_') ? 'SANDBOX/TEST' : 'LIVE';
  console.log(`Stripe: ${mode}`);
  console.log(apply ? 'Mode:   APPLY\n' : 'Mode:   DRY RUN (pass --apply to write)\n');

  const offenders = PACKS.filter(violatesTierLadder);
  if (offenders.length > 0) {
    console.error(
      `Refusing to sync — ${offenders.length} pack(s) priced below the best subscription rate ` +
        `($${BEST_SUBSCRIPTION_RATE_USD}/credit).`,
    );
    process.exit(1);
  }

  console.log(
    `${'pack'.padEnd(12)}${'amount'.padStart(8)}${'credits'.padStart(9)}  ${'lookup_key'.padEnd(24)}action`,
  );
  console.log('─'.repeat(78));

  let created = 0;
  let reused = 0;
  let linked = 0;

  for (const p of PACKS) {
    // The pack row must already exist — seed-packs-catalog.ts owns that.
    const packRow = await q<{ id: string }>(
      `SELECT id FROM credit_packs WHERE store_product_id = '${p.key}' AND is_active = true`,
    );
    if (!packRow[0]) {
      console.log(
        `${p.key.padEnd(12)}${'—'.padStart(8)}${'—'.padStart(9)}  (no credit_packs row — run seed-packs-catalog.ts first)`,
      );
      continue;
    }

    const lookupKey = `clickefy_${p.key}`;
    const product = await findOrCreateProduct(p.key, p.displayName);

    const existing = await stripe.prices.list({
      lookup_keys: [lookupKey],
      limit: 1,
      active: true,
    });
    let price = existing.data[0];
    let action: string;

    if (price && price.unit_amount === p.priceCents && price.currency === CURRENCY) {
      action = 'reuse';
      reused += 1;
    } else if (price) {
      action = `REPRICE ${(price.unit_amount ?? 0) / 100} → ${p.priceCents / 100}`;
      if (apply) {
        await stripe.prices.update(price.id, {
          lookup_key: `${lookupKey}_old_${Math.floor(Date.now() / 1000)}`,
          active: false,
        });
        price = await stripe.prices.create({
          product: product.id,
          currency: CURRENCY,
          unit_amount: p.priceCents,
          // NO `recurring` — this is what makes it a one-time purchase.
          lookup_key: lookupKey,
          metadata: {
            clickefy_pack: p.key,
            clickefy_credits: String(p.credits),
            clickefy_bonus: String(p.bonusCredits),
          },
        });
        created += 1;
      }
    } else {
      action = 'create';
      if (apply) {
        price = await stripe.prices.create({
          product: product.id,
          currency: CURRENCY,
          unit_amount: p.priceCents,
          // NO `recurring` — one-time.
          lookup_key: lookupKey,
          metadata: {
            clickefy_pack: p.key,
            clickefy_credits: String(p.credits),
            clickefy_bonus: String(p.bonusCredits),
          },
        });
        created += 1;
      }
    }

    console.log(
      `${p.key.padEnd(12)}${('$' + p.priceCents / 100).padStart(8)}` +
        `${totalCredits(p).toLocaleString().padStart(9)}  ${lookupKey.padEnd(24)}${action}`,
    );

    if (apply && price?.id) {
      await q(`
        INSERT INTO pack_products (pack_id, platform, store_product_id, price_usd, is_active)
        VALUES ('${packRow[0].id}'::uuid, 'stripe', '${price.id}', ${p.priceCents / 100}, true)
        ON CONFLICT (pack_id, platform) DO UPDATE
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

  console.log(`\n${created} price(s) created, ${reused} reused, ${linked} linked to packs.`);

  const rows = await q<{
    store_product_id: string;
    price_usd: string;
    credits: number;
    bonus_credits: number;
  }>(`SELECT pp.store_product_id, pp.price_usd, cp.credits, cp.bonus_credits
        FROM pack_products pp JOIN credit_packs cp ON cp.id = pp.pack_id
       WHERE pp.platform = 'stripe' AND pp.is_active
       ORDER BY cp.display_order`);
  console.log('\nStripe packs now linked:');
  for (const r of rows) {
    const total = r.credits + r.bonus_credits;
    console.log(
      `  $${String(r.price_usd).padStart(7)}  ${total.toLocaleString().padStart(7)}cr  ${r.store_product_id}`,
    );
  }

  // A pack whose per-credit rate quietly drifted under a plan's is the
  // failure this ladder guards against; restate it so the operator sees
  // the shape they just shipped.
  console.log('\nEffective rates (must stay above $0.0079 — Ultimate):');
  for (const p of PACKS) {
    console.log(`  ${p.key.padEnd(12)} $${pricePerCredit(p).toFixed(4)}/credit`);
  }
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
