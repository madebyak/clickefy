/**
 * Seed Nano Banana 2.1 (`gemini-nano-banana-2.1`, GA 2026-10-06).
 *
 * PRICES follow the house rule, credits = ceil(usd × 1.5 / 0.10), on
 * Google's regular per-image prices (ai.google.dev/gemini-api/docs/pricing,
 * read 2026-10-06): 1K $0.0336 → 1 cr, 2K $0.0504 → 1 cr, 4K $0.0756 → 2 cr.
 * `cost_per_call_usd` is the default (1K) tier.
 *
 * Inserts the row `active` — the model was probed live through our own
 * `generateContent` request shape before this script existed. Idempotent:
 * an existing row only gets its capabilities JSON refreshed; status,
 * credits and tier pricing are LEFT ALONE unless `--reprice`.
 *
 * Usage (from apps/api):
 *   DATABASE_URL=… pnpm tsx scripts/seed-nano-banana-2-1.ts            # dry run
 *   DATABASE_URL=… pnpm tsx scripts/seed-nano-banana-2-1.ts --apply
 *   DATABASE_URL=… pnpm tsx scripts/seed-nano-banana-2-1.ts --apply --reprice
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

const MODEL_KEY = 'gemini-nano-banana-2.1';
const PROVIDER = 'gemini' as const;
const cap = MODEL_CAPABILITIES[MODEL_KEY];
if (!cap) throw new Error(`registry has no ${MODEL_KEY}`);

const row = {
  provider: PROVIDER,
  modelKey: MODEL_KEY,
  displayName: cap.displayName,
  capabilities: JSON.parse(JSON.stringify(cap)) as Record<string, unknown>,
  costPerCallUsd: '0.0336',
  costCredits: 1,
  tierPricing: { '1K': 1, '2K': 1, '4K': 2 },
};

async function main() {
  const [existing] = await db
    .select({ id: providerModels.id, status: providerModels.status, costCredits: providerModels.costCredits, tierPricing: providerModels.tierPricing })
    .from(providerModels)
    .where(and(eq(providerModels.provider, PROVIDER), eq(providerModels.modelKey, MODEL_KEY)))
    .limit(1);

  const action = existing ? (reprice ? 'update + reprice' : 'update capabilities only') : 'insert (active)';
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${PROVIDER}/${MODEL_KEY} → ${action}  ${row.costCredits} cr  ${JSON.stringify(row.tierPricing)}`);
  if (existing) console.log('  existing:', JSON.stringify(existing));
  if (!apply) return;

  if (!existing) {
    await db.insert(providerModels).values({
      provider: row.provider,
      modelKey: row.modelKey,
      displayName: row.displayName,
      status: 'active',
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
