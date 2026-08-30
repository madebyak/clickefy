/**
 * One-off pricing — Seedream 5.0 Pro (`dola-seedream-5-0-pro-260628`).
 *
 * Reference cost is the 2K tier we actually target ($0.09/image; the
 * ≤1.5K tier is $0.045 but our pixel solver aims 2048²). At the
 * catalog's ~2.0x markup that is 18cr; priced at 22cr instead because
 * 5.0 pro is the only Seedream that BILLS input images ($0.003 each
 * from the 2nd, up to 10 refs → worst case +$0.027/call) and the
 * pricing model has no input-image dimension — the 4cr headroom keeps
 * the worst case near catalog margin instead of ~1.1x effective.
 *
 * SAFETY: UPDATE only, scoped to the one row, refuses to overwrite a
 * non-zero price (admin owns prices after first set), dry-run default.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/price-seedream-5-pro-2026-08.ts            # dry run
 *   DATABASE_URL=... pnpm tsx scripts/price-seedream-5-pro-2026-08.ts --apply
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);

const CREDITS = 22;

async function main() {
  const host = new URL(url!.replace('postgresql://', 'https://')).hostname;
  console.log(`Target: ${host}`);
  console.log(apply ? 'Mode:   APPLY\n' : 'Mode:   DRY RUN (pass --apply to write)\n');

  const rows = (await sql(
    `select cost_credits, status from provider_models
      where provider = 'seedance' and model_key = 'dola-seedream-5-0-pro-260628'`,
    [],
  )) as unknown as Array<{ cost_credits: number; status: string }>;
  const row = rows[0];
  if (!row) {
    console.error('ABORT — row does not exist. Run seed-provider-models first.');
    process.exit(1);
  }
  if (row.cost_credits === CREDITS) {
    console.log(`  =  already ${CREDITS}cr`);
    return;
  }
  if (row.cost_credits > 0) {
    console.error(
      `ABORT — cost_credits is already ${row.cost_credits} (admin-set?). Not overwriting.`,
    );
    process.exit(1);
  }
  if (apply) {
    await sql(
      `update provider_models set cost_credits = $1, updated_at = now()
        where provider = 'seedance' and model_key = 'dola-seedream-5-0-pro-260628'`,
      [CREDITS],
    );
    const after = (await sql(
      `select cost_credits from provider_models
        where provider = 'seedance' and model_key = 'dola-seedream-5-0-pro-260628'`,
      [],
    )) as unknown as Array<{ cost_credits: number }>;
    console.log(
      `  ${after[0]?.cost_credits === CREDITS ? '✓' : '✗ MISMATCH'}  0cr → ${CREDITS}cr ($0.09 @2K x2 + input-image headroom)`,
    );
  } else {
    console.log(`  ·  0cr → ${CREDITS}cr ($0.09 @2K x2 + input-image headroom)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
