/**
 * Margin pass — move the catalogue from ~3.0x to ~2.0x markup.
 *
 * WHY THE HEADLINE NUMBER IS NOT THE REAL ONE
 *
 * Every price in this catalogue was set as `trueCost x 3.0 / $0.01`,
 * on a house anchor of 1 credit = $0.01. But a credit does not sell for
 * a cent — it sells for what a plan implies:
 *
 *     top-ups        $0.01000 / credit
 *     basic   $19    $0.00950
 *     creator $39    $0.00867
 *     pro     $75    $0.00833
 *     ultimate $99   $0.00792   <- the thinnest, and our best customers
 *
 * So the "3.0x" was really 2.38x against ultimate. Everything below is
 * reasoned against $0.00792, because a margin that only holds for the
 * cheapest plan is not a margin.
 *
 *     markup   effective   gross margin
 *      3.0x      2.38x        58%   <- before
 *      2.0x      1.58x        37%   <- after (this pass)
 *      1.26x     1.00x         0%   <- break-even. The floor.
 *
 * Below 1.26x we would pay for the privilege of serving an ultimate
 * subscriber. The gap between 1.58x and that floor is what covers Stripe
 * (~3%), R2 storage (up to $7.50/mo for an ultimate at full quota), the
 * promo credits outstanding with no revenue behind them, retried and
 * failed generations, and support.
 *
 * WHAT THIS PASS DELIBERATELY DOES NOT TOUCH
 *
 *   The four Seedance VIDEO models. Their recorded costs are known to be
 *   wrong in BOTH directions:
 *
 *     - The base figures assume 30fps output where the models emit 24,
 *       so 480p/720p are OVER-priced — cutting them is safe but would
 *       lock in the wrong reference.
 *     - 4K uses a 2.08x step over 1080p where the pixel-correct ratio is
 *       4.0x, so 4K is UNDER-priced. Seedance 2.0 @4K is 1167cr against
 *       a recorded $3.89; if the true cost is nearer $7.50, cutting it
 *       to 778cr turns $9.24 of revenue into $6.16 against $7.50 — a
 *       loss on every 4K second.
 *
 *   Applying a margin cut on top of cost figures we know are wrong
 *   would bake the error in permanently, and in the 4K case would
 *   manufacture a loss-maker. They are repriced in their own pass once
 *   the ModelArk rate is confirmed.
 *
 * SAFETY
 *   - UPDATE only. No DELETE, no TRUNCATE, no DDL. Every statement is
 *     scoped to one (provider, model_key) pair.
 *   - Refuses to run unless every target row already exists.
 *   - Refuses to run if any computed price would fall below the
 *     break-even floor for that model.
 *   - Prints a before/after diff and re-reads from the database to
 *     confirm, rather than trusting the write.
 *   - `--apply` is required; the default is a dry run.
 *   - Published templates freeze their price at publish time, so this
 *     changes what NEW generations cost, never what an existing
 *     template charges.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/reprice-margin-2026-08.ts          # dry run
 *   DATABASE_URL=... pnpm tsx scripts/reprice-margin-2026-08.ts --apply
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);

/** The markup the catalogue was built on, and the one we are moving to. */
const OLD_MARKUP = 3.0;
const NEW_MARKUP = 2.0;
const FACTOR = NEW_MARKUP / OLD_MARKUP;

/** House anchor. Only used to recover the true cost from a credit price. */
const CREDIT_ANCHOR_USD = 0.01;

/** The cheapest credit we sell (ultimate). Margins are judged here. */
const WORST_CASE_CREDIT_USD = 0.00792;

/**
 * Effective margin below which we refuse to write. 1.0x is break-even
 * before Stripe fees and storage, so 1.2x is the real red line.
 */
const MIN_EFFECTIVE_MARGIN = 1.2;

/**
 * Models to reprice. Seedance video is absent on purpose — see the
 * header. Listing them explicitly rather than "everything except" means
 * a newly-seeded model is never silently repriced by a stale script.
 */
const TARGETS = [
  'gemini-3-pro-image',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gpt-image-2',
  'seedream-4-0-250828',
  'seedream-5-0-260128',
  'kling-v2-5-turbo',
  'kling-v2-6',
  'kling-v2-master',
  'kling-o1',
  'kling-v3',
  'kling-v3-omni',
  'kling-v3-turbo',
];

/** True cost implied by a price that was set at the old markup. */
const trueCostOf = (credits: number) => (credits * CREDIT_ANCHOR_USD) / OLD_MARKUP;

const effectiveMargin = (newCredits: number, oldCredits: number) =>
  (newCredits * WORST_CASE_CREDIT_USD) / trueCostOf(oldCredits);

/**
 * Rounding must never push a price through the floor.
 *
 * At the bottom of the catalogue one credit is a big relative step:
 * GPT Image's `low` tier is 2cr, and 2 x 2/3 rounds to 1 — a 1.19x
 * margin, under the red line. Rounding up there costs the user a
 * fraction of a cent and keeps every tier above water.
 */
const reprice = (credits: number) => {
  const nearest = Math.max(1, Math.round(credits * FACTOR));
  if (effectiveMargin(nearest, credits) >= MIN_EFFECTIVE_MARGIN) return nearest;
  return Math.max(1, Math.ceil(credits * FACTOR));
};

interface Row {
  provider: string;
  model_key: string;
  display_name: string;
  cost_credits: number | null;
  tier_pricing: Record<string, number> | null;
}

const rows = (await sql`
  SELECT provider, model_key, display_name, cost_credits, tier_pricing
  FROM provider_models
  WHERE model_key = ANY(${TARGETS})
`) as unknown as Row[];

const missing = TARGETS.filter((k) => !rows.some((r) => r.model_key === k));
if (missing.length > 0) {
  console.error(`Refusing to run — these models are not in the catalogue:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

interface Change {
  provider: string;
  modelKey: string;
  displayName: string;
  fromCredits: number;
  toCredits: number;
  fromTiers: Record<string, number> | null;
  toTiers: Record<string, number> | null;
  margin: number;
}

const changes: Change[] = [];
const refusals: string[] = [];

for (const r of rows) {
  const from = Number(r.cost_credits ?? 0);
  if (!from) {
    refusals.push(`${r.model_key}: unpriced (cost_credits is 0/null) — seed it first`);
    continue;
  }
  const to = reprice(from);
  const margin = effectiveMargin(to, from);
  if (margin < MIN_EFFECTIVE_MARGIN) {
    refusals.push(`${r.model_key}: base would land at ${margin.toFixed(2)}x, under the ${MIN_EFFECTIVE_MARGIN}x floor`);
    continue;
  }

  let toTiers: Record<string, number> | null = null;
  if (r.tier_pricing) {
    toTiers = {};
    for (const [tier, credits] of Object.entries(r.tier_pricing)) {
      const next = reprice(Number(credits));
      const tierMargin = effectiveMargin(next, Number(credits));
      if (tierMargin < MIN_EFFECTIVE_MARGIN) {
        refusals.push(`${r.model_key} [${tier}]: would land at ${tierMargin.toFixed(2)}x, under the floor`);
      }
      toTiers[tier] = next;
    }
  }

  changes.push({
    provider: r.provider,
    modelKey: r.model_key,
    displayName: r.display_name,
    fromCredits: from,
    toCredits: to,
    fromTiers: r.tier_pricing,
    toTiers,
    margin,
  });
}

if (refusals.length > 0) {
  console.error('\nRefusing to run:\n  ' + refusals.join('\n  '));
  process.exit(1);
}

console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — markup ${OLD_MARKUP}x → ${NEW_MARKUP}x (credits x ${FACTOR.toFixed(4)})`);
console.log(`Margins judged against $${WORST_CASE_CREDIT_USD}/credit (ultimate tier).\n`);
console.log('model                          base            effective   tiers');
console.log('─'.repeat(92));
for (const c of changes) {
  const tiers = c.toTiers
    ? Object.keys(c.toTiers)
        .map((t) => `${t} ${c.fromTiers![t]}→${c.toTiers![t]}`)
        .join('  ')
    : '—';
  console.log(
    ` ${c.displayName.padEnd(26)} ${String(c.fromCredits).padStart(5)} → ${String(c.toCredits).padStart(5)}   ` +
      `${c.margin.toFixed(2)}x        ${tiers}`,
  );
}

if (!apply) {
  console.log('\nDry run — nothing written. Re-run with --apply.');
  process.exit(0);
}

for (const c of changes) {
  if (c.toTiers) {
    await sql`
      UPDATE provider_models
      SET cost_credits = ${c.toCredits},
          tier_pricing = ${JSON.stringify(c.toTiers)}::jsonb,
          updated_at = now()
      WHERE provider = ${c.provider} AND model_key = ${c.modelKey}`;
  } else {
    await sql`
      UPDATE provider_models
      SET cost_credits = ${c.toCredits}, updated_at = now()
      WHERE provider = ${c.provider} AND model_key = ${c.modelKey}`;
  }
}

// Re-read rather than trusting the write.
const after = (await sql`
  SELECT model_key, cost_credits, tier_pricing FROM provider_models
  WHERE model_key = ANY(${TARGETS}) ORDER BY model_key
`) as unknown as Row[];

let wrong = 0;
for (const c of changes) {
  const got = after.find((a) => a.model_key === c.modelKey);
  const okBase = Number(got?.cost_credits) === c.toCredits;
  const okTiers =
    !c.toTiers || JSON.stringify(got?.tier_pricing) === JSON.stringify(c.toTiers);
  if (!okBase || !okTiers) {
    wrong++;
    console.error(` ✘ ${c.modelKey}: expected ${c.toCredits} ${JSON.stringify(c.toTiers)}, got ${got?.cost_credits} ${JSON.stringify(got?.tier_pricing)}`);
  }
}
console.log(
  wrong === 0
    ? `\n✔ ${changes.length} models repriced and verified against the database.`
    : `\n✘ ${wrong} model(s) did not match after the write.`,
);
process.exit(wrong === 0 ? 0 : 1);
