/**
 * Seed the three ElevenLabs rows in `provider_models` (Phase 2, Audio
 * section). Prices follow the plan's defaults:
 *
 *   eleven-tts   3 credits per started 1,000 characters   (cost $0.165 / 1k)
 *   eleven-sfx   1 credit per clip, up to 30 s             (cost $0.002 / s)
 *   eleven-sts   2 credits per started minute of input     (cost $0.002 / s)
 *
 * Dry run by default; `--apply` writes; `--reprice` also overwrites the
 * price on an existing row. Usage (from apps/api):
 *   DATABASE_URL=… pnpm tsx scripts/seed-audio-models.ts [--apply] [--reprice]
 */

import { and, eq } from 'drizzle-orm';

import { createDb, providerModels } from '@clickfy/db';
import { MODEL_CAPABILITIES } from '@clickfy/providers';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const apply = process.argv.includes('--apply');
const reprice = process.argv.includes('--reprice');
const db = createDb({ connectionString: url, runtime: 'http' });

const ROWS = [
  { modelKey: 'eleven-tts', displayName: 'ElevenLabs Speech', costPerCallUsd: '0.1650', costCredits: 3, tierPricing: { per_1k_chars: 3 } },
  { modelKey: 'eleven-sfx', displayName: 'ElevenLabs Sound Effects', costPerCallUsd: '0.0200', costCredits: 1, tierPricing: { flat: 1 } },
  { modelKey: 'eleven-sts', displayName: 'ElevenLabs Voice Changer', costPerCallUsd: '0.1200', costCredits: 2, tierPricing: { per_minute: 2 } },
] as const;

async function main() {
  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — ${new URL(url!).host}\n`);
  for (const r of ROWS) {
    const cap = MODEL_CAPABILITIES[r.modelKey];
    if (!cap) throw new Error(`registry has no ${r.modelKey}`);
    const capabilities = JSON.parse(JSON.stringify(cap)) as Record<string, unknown>;
    const existing = await db.query.providerModels.findFirst({
      where: and(eq(providerModels.provider, 'elevenlabs'), eq(providerModels.modelKey, r.modelKey)),
    });
    if (existing) {
      console.log(`= ${r.modelKey} exists (${existing.status}, ${existing.costCredits} cr, ${JSON.stringify(existing.tierPricing)})${reprice ? ' → repricing' : ''}`);
      if (apply) {
        await db.update(providerModels).set({
          capabilities,
          displayName: r.displayName,
          ...(reprice ? { costCredits: r.costCredits, tierPricing: { ...r.tierPricing }, costPerCallUsd: r.costPerCallUsd } : {}),
        }).where(eq(providerModels.id, existing.id));
      }
      continue;
    }
    console.log(`+ ${r.modelKey}: ${r.costCredits} cr, ${JSON.stringify(r.tierPricing)}, cost $${r.costPerCallUsd}`);
    if (apply) {
      await db.insert(providerModels).values({
        provider: 'elevenlabs',
        modelKey: r.modelKey,
        displayName: r.displayName,
        status: 'active',
        capabilities,
        costPerCallUsd: r.costPerCallUsd,
        costCredits: r.costCredits,
        tierPricing: { ...r.tierPricing },
      });
    }
  }
  console.log(apply ? '\ndone' : '\n(dry run — add --apply)');
}
main().catch((e) => { console.error(e); process.exit(1); });
