/**
 * Price the Video Upscaler — September 2026.
 *
 * WHAT CHANGED, AND WHY IT MATTERED
 *   The first version of this script priced the model as ONE number:
 *   `tier_pricing` was NULL because a 10-second invoice line read
 *   `10.00 seconds x $0.0072` and 1080p was assumed to be every
 *   resolution's price. It was a 1080p job — the one resolution where
 *   the multiplier happens to be 1. fal's own pricing note:
 *
 *     1080p $0.0072/s · 2K $0.0144/s · 4K $0.0288/s, at 30fps.
 *     60fps output doubles any of them.
 *     The `pro` enhancement tier multiplies by TEN.
 *
 *   So the most expensive combination we offer costs 80x the cheapest,
 *   and the flat price would have sold an $0.58/second job for $0.02.
 *
 * THE KEY SHAPE
 *   Three dimensions, one `tier_pricing` key — `4k_60_pro` — composed by
 *   `upscalePriceKey` in @clickfy/types and looked up by the ordinary
 *   `resolveCreditCost` tier path. Same convention as Kling's
 *   `${tier}_audio` keys: the catalogue carries the combinations, the
 *   resolver stays one function. The API composes the same key from the
 *   request, so what is displayed and what is charged are one lookup.
 *
 * 6K AND 8K ARE ESTIMATES
 *   fal publishes prices only to 4K. The model offers 6K and 8K, so they
 *   are priced by continuing the published doubling (1x / 2x / 4x → 8x /
 *   16x), which also tracks pixel count. Over-charging slightly is the
 *   safe direction here; the first real invoice line at either size
 *   should be checked against `ESTIMATED_USD_PER_SECOND` below.
 *
 * `cost_credits` stays the price of FIVE SECONDS at the DEFAULT key
 * (1080p, 30fps, standard). Every other length scales linearly from the
 * matching tier key, driven by the probed duration of the upload.
 *
 * SAFETY
 *   - INSERT ... ON CONFLICT DO UPDATE on (provider, model_key) — the
 *     table's actual unique key. No other row is touched, and re-running
 *     is a no-op that re-asserts the price.
 *   - `--apply` required; dry run prints the full table it would write.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/seed-fal-upscaler.ts
 *   DATABASE_URL=... pnpm tsx scripts/seed-fal-upscaler.ts --apply
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);

const MODEL_KEY = 'bytedance-upscaler';
const REFERENCE_SECONDS = 5;
const MARKUP = 1.5;
const CREDIT_USD = 0.1;

/**
 * fal's per-source-second rate at 30fps on the standard tier.
 * 1080p / 2K / 4K are published. 6K / 8K continue the doubling and are
 * marked as estimates — see the header.
 */
const USD_PER_SECOND: Record<string, number> = {
  '1080p': 0.0072,
  '2k': 0.0144,
  '4k': 0.0288,
  '6k': 0.0576,
  '8k': 0.1152,
};
const ESTIMATED = new Set(['6k', '8k']);
/** 60fps output doubles the rate; the `pro` tier multiplies it by ten. */
const FPS_MULTIPLIER = 2;
const PRO_MULTIPLIER = 10;

const RESOLUTIONS = ['1080p', '2k', '4k', '6k', '8k'] as const;

/** Mirrors `upscalePriceKey` in @clickfy/types — the API composes the same string. */
function priceKey(resolution: string, fps: number, tier: 'standard' | 'pro'): string {
  const parts = [resolution];
  if (fps > 30) parts.push('60');
  if (tier === 'pro') parts.push('pro');
  return parts.join('_');
}

function usdPerSecond(resolution: string, fps: number, tier: 'standard' | 'pro'): number {
  return (
    USD_PER_SECOND[resolution]! *
    (fps > 30 ? FPS_MULTIPLIER : 1) *
    (tier === 'pro' ? PRO_MULTIPLIER : 1)
  );
}

/** Credits for the reference length, at our markup. Never below 1. */
function credits(resolution: string, fps: number, tier: 'standard' | 'pro'): number {
  const costUsd = usdPerSecond(resolution, fps, tier) * REFERENCE_SECONDS;
  return Math.max(1, Math.ceil((costUsd * MARKUP) / CREDIT_USD));
}

const tierPricing: Record<string, number> = {};
for (const resolution of RESOLUTIONS) {
  for (const fps of [30, 60] as const) {
    for (const tier of ['standard', 'pro'] as const) {
      tierPricing[priceKey(resolution, fps, tier)] = credits(resolution, fps, tier);
    }
  }
}

/** The default combination — what `cost_credits` quotes. */
const baseCredits = credits('1080p', 30, 'standard');
const baseCostUsd = usdPerSecond('1080p', 30, 'standard') * REFERENCE_SECONDS;

/**
 * Mirrors the code registry entry. `provider_models.capabilities` is what
 * the API serves to clients; the code registry is what the compiler
 * reads. They must agree, which is why this is written from the same
 * numbers rather than typed twice from memory.
 */
const capabilities = {
  kind: 'video',
  modes: {
    values: [...RESOLUTIONS],
    default: '1080p',
    labels: { '1080p': '1080p', '2k': '2K', '4k': '4K', '6k': '6K', '8k': '8K' },
  },
  duration: { values: [], default: REFERENCE_SECONDS },
  billsSourceDuration: true,
  upscaleOptions: {
    presets: ['general', 'ugc', 'short_series', 'aigc', 'old_film'],
    tiers: ['fast', 'standard', 'pro'],
    fps: [30, 60],
    fidelities: ['high', 'medium'],
    bitDepths: [8, 10, 12],
    defaults: {
      resolution: '1080p',
      preset: 'aigc',
      tier: 'standard',
      fps: 30,
      fidelity: 'high',
      bitDepth: 8,
    },
  },
  referenceVideo: { max: 1, maxTotalSeconds: 60, minClipSeconds: 1, maxClipSeconds: 60 },
  maxReferences: 0,
  maxPromptChars: 0,
};

async function main() {
  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — Video Upscaler`);
  console.log(`database: ${new URL(url!).host}\n`);
  console.log(`  markup ${MARKUP}x at $${CREDIT_USD}/credit, quoted at ${REFERENCE_SECONDS}s\n`);
  console.log(
    `  ${'key'.padEnd(14)}${'$/second'.padStart(10)}${'credits/5s'.padStart(12)}${'  (60s clip)'}`,
  );
  for (const key of Object.keys(tierPricing)) {
    const [res] = key.split('_');
    const rate = usdPerSecond(res!, key.includes('_60') ? 60 : 30, key.endsWith('pro') ? 'pro' : 'standard');
    const c = tierPricing[key]!;
    console.log(
      `  ${key.padEnd(14)}${('$' + rate.toFixed(4)).padStart(10)}${String(c).padStart(12)}` +
        `      ${c * 12}${ESTIMATED.has(res!) ? '   ← estimated rate' : ''}`,
    );
  }
  console.log(`\n  cost_credits ${baseCredits}  (the default key, 1080p/30fps/standard)`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  await sql`
    INSERT INTO provider_models (
      provider, model_key, display_name, status,
      cost_credits, cost_per_call_usd, tier_pricing, capabilities, timeout_ms
    )
    VALUES (
      'fal', ${MODEL_KEY}, 'ByteDance Upscale', 'active',
      ${baseCredits}, ${baseCostUsd}, ${JSON.stringify(tierPricing)}::jsonb,
      ${JSON.stringify(capabilities)}::jsonb,
      -- 2 hours: 24x realtime at 1080p/standard, and materially
      -- slower at 4K or on the pro tier. Matches ASYNC_POLL_BUDGET_MS.
      ${120 * 60 * 1000}
    )
    ON CONFLICT (provider, model_key) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      status = EXCLUDED.status,
      -- There is no kind column: it lives inside capabilities, which is
      -- replaced wholesale below.
      cost_credits = EXCLUDED.cost_credits,
      cost_per_call_usd = EXCLUDED.cost_per_call_usd,
      tier_pricing = EXCLUDED.tier_pricing,
      capabilities = EXCLUDED.capabilities,
      timeout_ms = EXCLUDED.timeout_ms,
      updated_at = now()`;

  const [row] = (await sql`
    SELECT provider, model_key, status, cost_credits, tier_pricing
    FROM provider_models WHERE model_key = ${MODEL_KEY}`) as unknown as Array<
    Record<string, unknown>
  >;
  console.log('\nWritten:', JSON.stringify(row));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
