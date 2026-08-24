/**
 * Seed `credit_packs` from the one pack ladder in `pack-catalogue.ts`.
 *
 * WHAT THIS DOES NOT DO
 *   It does not touch `pack_products`. Storefront identifiers are created
 *   alongside the real Stripe prices by `sync-stripe-packs.ts`, and real
 *   ids only — production already carries the scars of hand-entered
 *   placeholders (`weekly`, `Pack-ultimate`). A pack with no product row
 *   simply is not purchasable yet, which the pricing page states plainly.
 *
 * SAFETY
 *   - `--apply` required; dry run by default.
 *   - Upsert on `store_product_id`, never DELETE. Re-running is a no-op.
 *   - Refuses to write a ladder that undercuts the best subscription
 *     rate — see `violatesTierLadder`. That is not a style preference:
 *     a top-up cheaper per credit than Ultimate makes the top tier
 *     pointless, and it is the kind of mistake that is invisible until
 *     someone graphs revenue per user.
 *   - Touches no credit column. Balances cannot move.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/seed-packs-catalog.ts
 *   DATABASE_URL=... pnpm tsx scripts/seed-packs-catalog.ts --apply
 */

import { neon } from '@neondatabase/serverless';

import {
  PACKS,
  marginAtFullUse,
  pricePerCredit,
  totalCredits,
  violatesTierLadder,
  BEST_SUBSCRIPTION_RATE_USD,
} from './pack-catalogue';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');

const sql = neon(dbUrl);
const q = <T = Record<string, unknown>>(s: string) =>
  sql(Object.assign([s], { raw: [s] }) as unknown as TemplateStringsArray) as unknown as Promise<
    T[]
  >;

async function main() {
  console.log(`DB:   ${dbUrl!.replace(/\/\/[^@]*@/, '//***@').split('/')[2]}`);
  console.log(apply ? 'Mode: APPLY\n' : 'Mode: DRY RUN (pass --apply to write)\n');

  // Refuse the whole run, not just the offending row: a ladder is a
  // shape, and a half-applied one is worse than none.
  const offenders = PACKS.filter(violatesTierLadder);
  if (offenders.length > 0) {
    console.error(
      `Refusing to seed — ${offenders.length} pack(s) priced below the best subscription rate ` +
        `($${BEST_SUBSCRIPTION_RATE_USD}/credit). That would make Ultimate pointless:`,
    );
    for (const p of offenders) {
      console.error(`  ${p.key}: $${pricePerCredit(p).toFixed(4)}/credit`);
    }
    process.exit(1);
  }

  console.log(
    `${'pack'.padEnd(12)}${'credits'.padStart(9)}${'bonus'.padStart(8)}${'total'.padStart(9)}` +
      `${'price'.padStart(8)}${'$/credit'.padStart(10)}${'margin'.padStart(9)}  action`,
  );
  console.log('─'.repeat(88));

  let inserted = 0;
  let updated = 0;

  for (const p of PACKS) {
    const existing = await q<{ id: string }>(
      `SELECT id FROM credit_packs WHERE store_product_id = '${p.key}'`,
    );
    const action = existing.length > 0 ? 'update' : 'insert';

    console.log(
      `${p.key.padEnd(12)}${p.credits.toLocaleString().padStart(9)}` +
        `${p.bonusCredits.toLocaleString().padStart(8)}${totalCredits(p).toLocaleString().padStart(9)}` +
        `${('$' + p.priceCents / 100).padStart(8)}${pricePerCredit(p).toFixed(4).padStart(10)}` +
        `${(Math.round(marginAtFullUse(p) * 100) + '%').padStart(9)}  ${action}`,
    );

    if (!apply) continue;

    // `store_product_id` is the pack's stable key here. The PER-PLATFORM
    // identifiers live in pack_products; this column predates that split
    // and now serves as the catalogue key.
    await q(`
      INSERT INTO credit_packs (
        store_product_id, display_name, credits, bonus_credits,
        display_order, is_featured, is_active
      )
      VALUES (
        '${p.key}', '${p.displayName.replace(/'/g, "''")}', ${p.credits}, ${p.bonusCredits},
        ${p.displayOrder}, ${p.isFeatured}, true
      )
      ON CONFLICT (store_product_id) DO UPDATE
        SET display_name  = EXCLUDED.display_name,
            credits       = EXCLUDED.credits,
            bonus_credits = EXCLUDED.bonus_credits,
            display_order = EXCLUDED.display_order,
            is_featured   = EXCLUDED.is_featured,
            is_active     = true,
            updated_at    = now()`);

    if (action === 'insert') inserted += 1;
    else updated += 1;
  }

  if (!apply) {
    console.log('\nRe-run with --apply to write these.');
    return;
  }

  console.log(`\n${inserted} inserted, ${updated} updated.`);

  const rows = await q<{
    store_product_id: string;
    credits: number;
    bonus_credits: number;
    is_active: boolean;
  }>(`SELECT store_product_id, credits, bonus_credits, is_active
        FROM credit_packs ORDER BY display_order`);
  console.log('\ncredit_packs now:');
  for (const r of rows) {
    console.log(
      `  ${r.store_product_id.padEnd(16)} ${String(r.credits).padStart(6)}cr ` +
        `+${String(r.bonus_credits).padStart(5)} ${r.is_active ? 'active' : 'RETIRED'}`,
    );
  }
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
