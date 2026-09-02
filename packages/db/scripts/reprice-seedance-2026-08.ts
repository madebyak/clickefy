/**
 * Seedance video — repriced against BytePlus's real token billing.
 *
 * THIS IS THE PASS `reprice-margin-2026-08.ts` DELIBERATELY SKIPPED. It
 * held these four back because their cost figures were unverified, and
 * cutting on top of wrong costs would have baked the error in. The
 * founder has now read the real numbers out of the ModelArk playground,
 * so they can be priced from the billing formula instead of a guess.
 *
 * ── THE FORMULA, CONFIRMED ────────────────────────────────────────────
 *
 *     tokens = (width x height x fps x seconds) / 1024
 *     cost   = tokens / 1000 x rate
 *
 * The playground's own tooltip states it, and two of the three sampled
 * resolutions reproduce to the cent at $0.0107 / 1k tokens:
 *
 *     480p  854x480    30s   288,225 tok   $3.0840  <- matches exactly
 *     720p  1280x720   30s   648,000 tok   $6.9336  <- matches exactly
 *     1080p 1920x1080  30s 1,458,000 tok  $12.2822  <- shown, not $15.60
 *
 * fps is 24, not 30 — solved from the 720p sample, not assumed. An
 * earlier note in this repo claimed the base figures assumed 30fps; that
 * was wrong. The 720p base cost was always right. What was wrong were the
 * high-resolution multipliers, which is where the money actually leaks.
 *
 * ── THE ONE FIGURE TAKEN ON TRUST ─────────────────────────────────────
 *
 * 1080p bills at an effective $0.008424 / 1k in that sample — 21% under
 * the rate the other two charge. The token count is exactly 1920x1080,
 * so either 1080p is discounted or the price was stale in the UI. The
 * founder confirmed the shown price is real, so 1080p is priced from
 * $12.2822 / 30s. If it turns out to be $15.60, the 1080p margin is ~18%
 * rather than ~35% and this needs re-running.
 *
 * The 2.0 models keep the undiscounted rate at every resolution, because
 * the discount was only ever observed on 2.5. Conservative in the right
 * direction: if they share it, we are earning more than planned.
 *
 * ── MARKUP ────────────────────────────────────────────────────────────
 *
 * 1.55x on true cost, quoted at the Creator rate ($39 / 4,500cr). Chosen
 * to fit the founder's own target prices, which imply 1.51x at 1080p and
 * 1.59x at 720p:
 *
 *     1080p 30s   $19.03   (target $18.50)
 *     1080p 10s   $ 6.34   (target $ 6.20)
 *     720p  30s   $10.76   (target $11.00)
 *
 * Their 25s target ($17.50) implies 1.71x and cannot be honoured: price
 * scales linearly with duration, so one base price cannot satisfy 1.51x
 * at 30s and 1.71x at 25s. 25s lands at $15.86 — cheaper for the user.
 *
 * That is ~35% gross margin at the Creator rate, and ~29% for an Ultimate
 * subscriber, who pays $0.00792 per credit rather than $0.00867. Below
 * the 45-50% the founder first asked for; they chose their own prices
 * over the margin target with that trade-off stated.
 *
 * SAFETY
 *   - UPDATE only. No DELETE, no TRUNCATE, no DDL. One (provider,
 *     model_key) pair per statement.
 *   - Refuses to run unless every target row already exists.
 *   - Refuses to write any price that would fall below cost.
 *   - Prints a before/after diff and re-reads from the database.
 *   - `--apply` is required; the default is a dry run.
 *   - Published templates freeze their price at publish time, so this
 *     changes new generations only.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/reprice-seedance-2026-08.ts
 *   DATABASE_URL=... pnpm tsx scripts/reprice-seedance-2026-08.ts --apply
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);

/** Credits per dollar at the Creator rate — the price the sheet quotes. */
const CREDIT_USD_CREATOR = 39 / 4500;
/** The thinnest credit we sell (Ultimate), for the margin we report. */
const CREDIT_USD_ULTIMATE = 0.00792;
/** Markup on true cost. See the header for how this was chosen. */
const MARKUP = 1.55;
/** Output frame rate, solved from the 720p sample. */
const FPS = 24;

/** Pixel dimensions per tier, as BytePlus bills them. */
const RESOLUTIONS: Record<string, [number, number]> = {
  '480p': [854, 480],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '4k': [3840, 2160],
};

/** tokens for one second at a resolution. */
const tokensPerSecond = (tier: string) => {
  const [w, h] = RESOLUTIONS[tier]!;
  return (w * h * FPS) / 1024;
};

interface Model {
  modelKey: string;
  label: string;
  /** $ per 1,000 tokens. */
  rate: number;
  /** Reference duration the stored base price is quoted for. */
  refSeconds: number;
  tiers: string[];
  /** Tier -> $/second measured directly, overriding the formula. */
  measured?: Record<string, number>;
}

const MODELS: Model[] = [
  {
    // The only model with directly observed billing. 480p and 720p are
    // the formula; 1080p is the figure read off the playground.
    modelKey: 'dreamina-seedance-2-5-260628',
    label: 'Seedance 2.5',
    rate: 0.0107,
    refSeconds: 5,
    tiers: ['480p', '720p', '1080p'],
    measured: { '1080p': 12.2822 / 30 },
  },
  // Rates recovered from each model's stored 720p/5s cost, which the
  // formula reproduces exactly for 2.5 — so the same derivation holds.
  {
    modelKey: 'dreamina-seedance-2-0-260128',
    label: 'Seedance 2.0 (Standard)',
    rate: 0.76 / 108,
    refSeconds: 5,
    tiers: ['480p', '720p', '1080p', '4k'],
  },
  {
    modelKey: 'dreamina-seedance-2-0-fast-260128',
    label: 'Seedance 2.0 Fast',
    rate: 0.6 / 108,
    refSeconds: 5,
    tiers: ['480p', '720p'],
  },
  {
    modelKey: 'dreamina-seedance-2-0-mini-260615',
    label: 'Seedance 2.0 Mini',
    rate: 0.38 / 108,
    refSeconds: 5,
    tiers: ['480p', '720p'],
  },
];

/** $ for one second of output at a tier. */
function costPerSecond(m: Model, tier: string): number {
  const measured = m.measured?.[tier];
  if (measured !== undefined) return measured;
  return (tokensPerSecond(tier) / 1000) * m.rate;
}

interface Change {
  modelKey: string;
  label: string;
  fromBase: number;
  toBase: number;
  fromTiers: Record<string, number> | null;
  toTiers: Record<string, number>;
  detail: Array<{ tier: string; cost5s: number; credits: number; gmCreator: number; gmUlt: number }>;
}

const rows = (await sql`
  SELECT model_key, display_name, cost_credits, tier_pricing
  FROM provider_models
  WHERE model_key = ANY(${MODELS.map((m) => m.modelKey)})
`) as unknown as Array<{
  model_key: string;
  display_name: string;
  cost_credits: number | null;
  tier_pricing: Record<string, number> | null;
}>;

const missing = MODELS.filter((m) => !rows.some((r) => r.model_key === m.modelKey));
if (missing.length > 0) {
  console.error(`Refusing to run — not in the catalogue:\n  ${missing.map((m) => m.modelKey).join('\n  ')}`);
  process.exit(1);
}

const changes: Change[] = [];
const refusals: string[] = [];

for (const m of MODELS) {
  const row = rows.find((r) => r.model_key === m.modelKey)!;
  const toTiers: Record<string, number> = {};
  const detail: Change['detail'] = [];

  for (const tier of m.tiers) {
    const cost5s = costPerSecond(m, tier) * m.refSeconds;
    const credits = Math.round((cost5s * MARKUP) / CREDIT_USD_CREATOR);
    // A price under cost is never a rounding artefact worth shipping.
    if (credits * CREDIT_USD_ULTIMATE <= cost5s) {
      refusals.push(`${m.modelKey} [${tier}]: ${credits}cr would sell under cost at the Ultimate rate`);
    }
    toTiers[tier] = credits;
    detail.push({
      tier,
      cost5s,
      credits,
      gmCreator: (credits * CREDIT_USD_CREATOR - cost5s) / (credits * CREDIT_USD_CREATOR),
      gmUlt: (credits * CREDIT_USD_ULTIMATE - cost5s) / (credits * CREDIT_USD_ULTIMATE),
    });
  }

  // `cost_credits` mirrors the tier the compiler sends when a stage pins
  // nothing. 720p is every Seedance model's default.
  const toBase = toTiers['720p']!;

  changes.push({
    modelKey: m.modelKey,
    label: m.label,
    fromBase: Number(row.cost_credits ?? 0),
    toBase,
    fromTiers: row.tier_pricing,
    toTiers,
    detail,
  });
}

if (refusals.length > 0) {
  console.error('\nRefusing to run:\n  ' + refusals.join('\n  '));
  process.exit(1);
}

console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — Seedance video at ${MARKUP}x true cost\n`);
for (const c of changes) {
  console.log(`${c.label}   base ${c.fromBase} → ${c.toBase}cr`);
  for (const d of c.detail) {
    const was = c.fromTiers?.[d.tier];
    const delta = was ? `${was} → ${d.credits}  (${((d.credits / was - 1) * 100).toFixed(0)}%)` : `→ ${d.credits}`;
    console.log(
      `   ${d.tier.padEnd(6)} cost/5s $${d.cost5s.toFixed(4)}   ${delta.padEnd(22)}` +
        `  30s sells $${(d.credits * 6 * CREDIT_USD_CREATOR).toFixed(2)}` +
        `   GM ${(d.gmCreator * 100).toFixed(0)}% / ${(d.gmUlt * 100).toFixed(0)}% ult`,
    );
  }
  console.log('');
}

if (!apply) {
  console.log('Dry run — nothing written. Re-run with --apply.');
  process.exit(0);
}

for (const c of changes) {
  await sql`
    UPDATE provider_models
    SET cost_credits = ${c.toBase},
        tier_pricing = ${JSON.stringify(c.toTiers)}::jsonb,
        updated_at = now()
    WHERE model_key = ${c.modelKey}`;
}

const after = (await sql`
  SELECT model_key, cost_credits, tier_pricing FROM provider_models
  WHERE model_key = ANY(${MODELS.map((m) => m.modelKey)})
`) as unknown as Array<{ model_key: string; cost_credits: number; tier_pricing: Record<string, number> }>;

let wrong = 0;
for (const c of changes) {
  const got = after.find((a) => a.model_key === c.modelKey);
  // Compare key-by-key: Postgres `jsonb` does not preserve insertion
  // order, so stringify comparison reports a false mismatch on a write
  // that actually succeeded.
  const sameTiers =
    got != null &&
    Object.keys(c.toTiers).length === Object.keys(got.tier_pricing ?? {}).length &&
    Object.entries(c.toTiers).every(([k, v]) => Number(got.tier_pricing?.[k]) === v);
  if (Number(got?.cost_credits) !== c.toBase || !sameTiers) {
    wrong++;
    console.error(` ✘ ${c.modelKey}: expected ${c.toBase} ${JSON.stringify(c.toTiers)}, got ${got?.cost_credits} ${JSON.stringify(got?.tier_pricing)}`);
  }
}
console.log(wrong === 0 ? `✔ ${changes.length} models repriced and verified against the database.` : `✘ ${wrong} mismatch(es).`);
process.exit(wrong === 0 ? 0 : 1);
