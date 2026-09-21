/**
 * Add the Video Upscaler to the catalogue — September 2026.
 *
 * PRICING, AND WHY IT IS ONE NUMBER
 *   fal bills the SOURCE duration at a flat $0.0072/second, whatever you
 *   upscale to. That is measured, not assumed: a 10-second clip to 1080p
 *   produced an invoice line of `10.00 seconds x $0.0072`, despite the
 *   job spending 242 seconds in inference. So `tier_pricing` is NULL —
 *   4K genuinely costs us what 1080p costs, and inventing a premium for
 *   it would be a markup on nothing.
 *
 *   `cost_credits` is the price of FIVE SECONDS, the model's reference
 *   length. Every other length is scaled by `resolveCreditCost`, which
 *   the API drives from the probed duration of the uploaded file.
 *
 *     5s  =  5 x $0.0072 = $0.036 -> x1.5 markup = $0.054 -> 1 credit
 *     10s =  2 credits    30s = 6 credits    60s = 12 credits
 *
 *   Rounding at this size favours the house heavily (a 5-second upscale
 *   earns nearly 3x), which is fine: the floor is what matters, and the
 *   floor is never below cost.
 *
 * SAFETY
 *   - INSERT ... ON CONFLICT DO UPDATE on (provider, model_key) — the
 *     table's actual unique key. No other row is touched, and re-running
 *     is a no-op that re-asserts the price.
 *   - `--apply` required; dry run prints what it would write.
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
/** What fal charges per second of SOURCE video. */
const USD_PER_SECOND = 0.0072;
const REFERENCE_SECONDS = 5;
const MARKUP = 1.5;
const CREDIT_USD = 0.1;

const costUsd = USD_PER_SECOND * REFERENCE_SECONDS;
const credits = Math.max(1, Math.ceil((costUsd * MARKUP) / CREDIT_USD));

/**
 * Mirrors the code registry entry. `provider_models.capabilities` is what
 * the API serves to clients; the code registry is what the compiler
 * reads. They must agree, which is why this is written from the same
 * numbers rather than typed twice from memory.
 */
const capabilities = {
  kind: 'video',
  modes: {
    values: ['1080p', '2k', '4k'],
    default: '1080p',
    labels: { '1080p': '1080p', '2k': '2K', '4k': '4K' },
  },
  duration: { values: [], default: REFERENCE_SECONDS },
  referenceVideo: { max: 1, maxTotalSeconds: 60, minClipSeconds: 1, maxClipSeconds: 60 },
  maxReferences: 0,
  maxPromptChars: 0,
};

async function main() {
  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — Video Upscaler`);
  console.log(`database: ${new URL(url!).host}\n`);
  console.log(`  cost to us   $${USD_PER_SECOND}/second of source video (flat, any target resolution)`);
  console.log(`  reference    ${REFERENCE_SECONDS}s = $${costUsd.toFixed(4)}`);
  console.log(`  markup       ${MARKUP}x at $${CREDIT_USD}/credit`);
  console.log(`  cost_credits ${credits}  (→ ${credits * 2} for 10s, ${credits * 12} for 60s)`);
  console.log(`  tier_pricing NULL — resolution does not change what fal charges\n`);

  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply.');
    return;
  }

  await sql`
    INSERT INTO provider_models (
      provider, model_key, display_name, status,
      cost_credits, cost_per_call_usd, tier_pricing, capabilities, timeout_ms
    )
    VALUES (
      'fal', ${MODEL_KEY}, 'Video Upscaler', 'active',
      ${credits}, ${costUsd}, NULL, ${JSON.stringify(capabilities)}::jsonb,
      -- 45 minutes: this model runs at roughly 24x realtime and the
      -- worker's poll budget matches.
      ${45 * 60 * 1000}
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
    SELECT provider, model_key, status, cost_credits, cost_per_call_usd
    FROM provider_models WHERE model_key = ${MODEL_KEY}`) as unknown as Array<Record<string, unknown>>;
  console.log('Written:', JSON.stringify(row));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
