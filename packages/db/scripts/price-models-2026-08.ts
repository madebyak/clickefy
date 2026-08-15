/**
 * One-off pricing pass — August 2026 model roster.
 *
 * Sets `cost_credits` for the newly-seeded Gemini GA and Seedream models,
 * and corrects Nano Banana 2, which was priced against a stale $0.04
 * reference when Google's actual rate is $0.067/image at 1K — a 1.5x
 * margin where the rest of the catalogue runs 2.5-3.3x.
 *
 * SAFETY
 *   - UPDATE only. No DELETE, no TRUNCATE, no DDL. Every statement is
 *     scoped to one (provider, model_key) pair.
 *   - Refuses to run unless every target row already exists; it will not
 *     create rows (that is the seed script's job).
 *   - Prints a before/after diff and re-reads from the database to
 *     confirm, rather than trusting the write.
 *   - `--apply` is required; the default is a dry run.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/price-models-2026-08.ts            # dry run
 *   DATABASE_URL=... pnpm tsx scripts/price-models-2026-08.ts --apply
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);

/**
 * Target credit price per model. House anchor is 1 credit = $0.01, and
 * the catalogue's established markup is ~3x true cost.
 *
 * Prices are for each model's BASE resolution tier. Resolution is not yet
 * a user-selectable priced tier (see docs/MODEL-INTEGRATION-PLAN.md §3),
 * so an admin-authored template that pins 4K on a Gemini model will run
 * at a thinner margin until `tier_pricing` is wired.
 */
const PRICES: Array<{
  provider: string;
  modelKey: string;
  credits: number;
  why: string;
}> = [
  // ── Gemini GA roster (newly seeded, currently unpriced) ───────────
  { provider: 'gemini', modelKey: 'gemini-3-pro-image', credits: 40, why: '$0.134 @1K → 3.0x' },
  { provider: 'gemini', modelKey: 'gemini-3.1-flash-image', credits: 20, why: '$0.067 @1K → 3.0x' },
  { provider: 'gemini', modelKey: 'gemini-3.1-flash-lite-image', credits: 10, why: '$0.0336 → 3.0x' },

  // ── Seedream (newly seeded, currently unpriced) ───────────────────
  // Flat price across every resolution tier, so no tier risk here.
  { provider: 'seedance', modelKey: 'seedream-4-0-250828', credits: 10, why: '$0.030 flat → 3.3x' },
  { provider: 'seedance', modelKey: 'seedream-5-0-260128', credits: 12, why: '$0.035 flat → 3.4x' },

  // ── Margin correction on the legacy preview key ───────────────────
  // 24 published templates still reference this key. Template prices are
  // frozen on the template row at publish time, so this does NOT change
  // what any existing template costs today — it only affects future
  // publishes. The create flow no longer offers preview keys at all.
  {
    provider: 'gemini',
    modelKey: 'gemini-3.1-flash-image-preview',
    credits: 20,
    why: 'was 10cr against a stale $0.04; true cost $0.067 → 1.5x, now 3.0x',
  },
];

type Row = { model_key: string; cost_credits: number; status: string; cost_per_call_usd: string };

async function read(provider: string, modelKey: string): Promise<Row | null> {
  const rows = (await sql(
    `select model_key, cost_credits, status, cost_per_call_usd
       from provider_models where provider = $1 and model_key = $2`,
    [provider, modelKey],
  )) as unknown as Row[];
  return rows[0] ?? null;
}

async function main() {
  const host = new URL(url!.replace('postgresql://', 'https://')).hostname;
  console.log(`Target: ${host}`);
  console.log(apply ? 'Mode:   APPLY\n' : 'Mode:   DRY RUN (pass --apply to write)\n');

  // Pre-flight: every target must already exist. A missing row means the
  // seed script has not run here yet, and creating one from a pricing
  // script would hide that.
  const missing: string[] = [];
  for (const p of PRICES) {
    if (!(await read(p.provider, p.modelKey))) missing.push(`${p.provider}/${p.modelKey}`);
  }
  if (missing.length > 0) {
    console.error('ABORT — these rows do not exist. Run db:seed-models first:');
    for (const m of missing) console.error(`  · ${m}`);
    process.exit(1);
  }

  let changed = 0;
  for (const p of PRICES) {
    const before = (await read(p.provider, p.modelKey))!;
    if (before.cost_credits === p.credits) {
      console.log(`  =  ${p.modelKey.padEnd(34)} already ${p.credits}cr`);
      continue;
    }

    if (apply) {
      await sql(
        `update provider_models set cost_credits = $1, updated_at = now()
           where provider = $2 and model_key = $3`,
        [p.credits, p.provider, p.modelKey],
      );
    }

    // Re-read rather than trusting the write.
    const after = apply ? (await read(p.provider, p.modelKey))! : before;
    const usd = Number(before.cost_per_call_usd);
    const mult = usd > 0 ? `${((p.credits * 0.01) / usd).toFixed(1)}x` : '—';
    const mark = apply ? (after.cost_credits === p.credits ? '✓' : '✗ MISMATCH') : '·';
    console.log(
      `  ${mark}  ${p.modelKey.padEnd(34)} ${String(before.cost_credits).padStart(3)}cr → ${String(p.credits).padStart(3)}cr   (${mult})  ${p.why}`,
    );
    changed += 1;
  }

  console.log(`\n${apply ? 'Applied' : 'Would change'} ${changed} row(s).`);

  // Any active, create-eligible model left at 0 credits is invisible in
  // the picker — worth surfacing rather than discovering in the UI.
  const unpriced = (await sql(
    `select provider, model_key from provider_models
      where cost_credits <= 0 and status <> 'deprecated' order by 1,2`,
  )) as unknown as Array<{ provider: string; model_key: string }>;
  if (unpriced.length > 0) {
    console.log('\nStill unpriced (hidden from the model picker):');
    for (const r of unpriced) console.log(`  · ${r.provider}/${r.model_key}`);
  }
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
