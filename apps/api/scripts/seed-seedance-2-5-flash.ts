/**
 * Seed Seedance 2.5 Flash (`dreamina-seedance-2-5-flash-261115`, BytePlus
 * API live 2026-11-15).
 *
 * PRICES follow the house rule, credits = ceil(usd × 1.5 / 0.10), on
 * BytePlus's token prices (ModelArk pricing page, read 2026-11-19):
 * $7.0 per million tokens, $4.3 with a video input, on the 2.5 frame
 * sizes at 24 fps. Per 5 seconds:
 *
 *   480p            48,037 tokens  $0.336  → 6 cr
 *   480p + video in                $0.207  → 4 cr
 *   720p           108,000 tokens  $0.756  → 12 cr
 *   720p + video in                $0.464  → 7 cr
 *
 * `cost_per_call_usd` and `cost_credits` are the default tier (720p, 5s),
 * the same convention as the other Seedance rows.
 *
 * Inserts the row `preview`, like every other Seedance model. The account
 * must have ACTIVATED the model in the Ark console first — until then
 * BytePlus answers 404 `ModelNotOpen` and every job on it fails (and
 * refunds). Idempotent: an existing row only gets its capabilities JSON
 * refreshed; status, credits and tier pricing are LEFT ALONE unless
 * `--reprice`.
 *
 * Usage (from apps/api):
 *   DATABASE_URL=… pnpm tsx scripts/seed-seedance-2-5-flash.ts            # dry run
 *   DATABASE_URL=… pnpm tsx scripts/seed-seedance-2-5-flash.ts --apply
 *   DATABASE_URL=… pnpm tsx scripts/seed-seedance-2-5-flash.ts --apply --reprice
 */

import { and, eq } from 'drizzle-orm';

import { createDb, providerModels } from '@clickfy/db';
import { MODEL_CAPABILITIES } from '@clickfy/providers';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const reprice = process.argv.includes('--reprice');
const db = createDb({ connectionString: url, runtime: 'http' });

const MODEL_KEY = 'dreamina-seedance-2-5-flash-261115';
const PROVIDER = 'seedance' as const;
const cap = MODEL_CAPABILITIES[MODEL_KEY];
if (!cap) throw new Error(`registry has no ${MODEL_KEY}`);

const row = {
  provider: PROVIDER,
  modelKey: MODEL_KEY,
  displayName: cap.displayName,
  capabilities: JSON.parse(JSON.stringify(cap)) as Record<string, unknown>,
  costPerCallUsd: '0.7560',
  costCredits: 12,
  tierPricing: { '480p': 6, '480p_videoin': 4, '720p': 12, '720p_videoin': 7 },
};

async function main() {
  const host = new URL(url!).host.split('.')[0];
  const [existing] = await db
    .select({ id: providerModels.id, status: providerModels.status, costCredits: providerModels.costCredits, tierPricing: providerModels.tierPricing })
    .from(providerModels)
    .where(and(eq(providerModels.provider, PROVIDER), eq(providerModels.modelKey, MODEL_KEY)))
    .limit(1);

  const action = existing ? (reprice ? 'update + reprice' : 'update capabilities only') : 'insert (preview)';
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} on ${host}: ${PROVIDER}/${MODEL_KEY} → ${action}  ${row.costCredits} cr  ${JSON.stringify(row.tierPricing)}`);
  if (existing) console.log('  existing:', JSON.stringify(existing));
  if (!apply) return;

  if (!existing) {
    await db.insert(providerModels).values({
      provider: row.provider,
      modelKey: row.modelKey,
      displayName: row.displayName,
      status: 'preview',
      capabilities: row.capabilities,
      costPerCallUsd: row.costPerCallUsd,
      costCredits: row.costCredits,
      tierPricing: row.tierPricing,
    });
  } else {
    await db
      .update(providerModels)
      .set({
        displayName: row.displayName,
        capabilities: row.capabilities,
        ...(reprice
          ? { costPerCallUsd: row.costPerCallUsd, costCredits: row.costCredits, tierPricing: row.tierPricing }
          : {}),
      })
      .where(eq(providerModels.id, existing.id));
  }

  const [after] = await db
    .select({ status: providerModels.status, costCredits: providerModels.costCredits, tierPricing: providerModels.tierPricing, costPerCallUsd: providerModels.costPerCallUsd })
    .from(providerModels)
    .where(and(eq(providerModels.provider, PROVIDER), eq(providerModels.modelKey, MODEL_KEY)))
    .limit(1);
  console.log('  after:', JSON.stringify(after));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
