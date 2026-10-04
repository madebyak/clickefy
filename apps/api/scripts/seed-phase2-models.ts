/**
 * Seed the Phase 2 models (client list verified 2026-10-05).
 *
 *   openai  gpt-image-2.5-sunburst, gpt-image-2.5-flare   (code registry; rows carry price)
 *   gemini  gemini-omni-1-1-flash                         (code registry; rows carry price)
 *   fal     wan-3-0, flux-3-image, flux-3-video, h3-max   (DATABASE-DRIVEN: the row IS the model)
 *
 * fal rows are validated with the same Zod schema the admin screen uses,
 * so what this seeds is exactly what "Add fal model" would have saved.
 * Field names and enums come from each endpoint's OpenAPI schema, read
 * on 2026-10-04 (`lib/fal-inspect.ts`).
 *
 * PRICES follow the house rule, credits = ceil(usd × 1.5 / 0.10), on the
 * providers' REGULAR per-unit prices at each tier's default length, never
 * the promos running in October 2026. `cost_per_call_usd` is the default
 * tier's USD at the default length.
 *
 * Idempotent upsert on (provider, model_key). Status is `preview` on first
 * insert so nothing is offered before its smoke test; an existing row's
 * status, credits and tier pricing are LEFT ALONE unless `--reprice`.
 *
 * Usage (from apps/api):
 *   DATABASE_URL=… pnpm tsx scripts/seed-phase2-models.ts            # dry run
 *   DATABASE_URL=… pnpm tsx scripts/seed-phase2-models.ts --apply
 *   DATABASE_URL=… pnpm tsx scripts/seed-phase2-models.ts --apply --reprice
 */

import { and, eq } from 'drizzle-orm';

import { createDb, providerModels } from '@clickfy/db';
import { MODEL_CAPABILITIES } from '@clickfy/providers';

import { falModelCapabilitiesSchema } from '../src/lib/fal-model-schema';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const reprice = process.argv.includes('--reprice');
const db = createDb({ connectionString: url, runtime: 'http' });

interface Row {
  provider: 'openai' | 'gemini' | 'fal';
  modelKey: string;
  displayName: string;
  capabilities: Record<string, unknown>;
  costPerCallUsd: string;
  costCredits: number;
  tierPricing: Record<string, number> | null;
}

const fromRegistry = (key: string) => {
  const cap = MODEL_CAPABILITIES[key];
  if (!cap) throw new Error(`registry has no ${key}`);
  return JSON.parse(JSON.stringify(cap)) as Record<string, unknown>;
};

const ROWS: Row[] = [
  // ── OpenAI: same token table as GPT Image 2 ($0.0527 at 1024² high) ──
  {
    provider: 'openai',
    modelKey: 'gpt-image-2.5-sunburst',
    displayName: 'GPT Image 2.5 Sunburst',
    capabilities: fromRegistry('gpt-image-2.5-sunburst'),
    costPerCallUsd: '0.0530',
    costCredits: 1,
    tierPricing: { low: 1, medium: 1, high: 4 },
  },
  {
    provider: 'openai',
    modelKey: 'gpt-image-2.5-flare',
    displayName: 'GPT Image 2.5 Flare',
    capabilities: fromRegistry('gpt-image-2.5-flare'),
    costPerCallUsd: '0.0530',
    costCredits: 1,
    tierPricing: { low: 1, medium: 1, high: 4 },
  },
  // ── Google: $17.50 per 1M video tokens; 360p ≈ 1,931 tok/s (measured),
  //    720p 5,792 tok/s (docs). The model picks the length and returned a
  //    10 s clip on the smoke test, so price per clip at 10 s: 360p $0.34 → 6,
  //    720p $1.01 → 16, 1080p estimated at 2.25× 720p → $2.28 → 35.
  {
    provider: 'gemini',
    modelKey: 'gemini-omni-1-1-flash',
    displayName: 'Gemini Omni 1.1',
    capabilities: fromRegistry('gemini-omni-1-1-flash'),
    costPerCallUsd: '1.0100',
    costCredits: 16,
    tierPricing: { '360p': 6, '720p': 16, '1080p': 35 },
  },
  // ── fal: Wan 3.0 — $0.05 / $0.10 / $0.20 per second; 5 s default ──
  {
    provider: 'fal',
    modelKey: 'wan-3-0',
    displayName: 'Wan 3.0',
    costPerCallUsd: '0.5000',
    costCredits: 8,
    tierPricing: { '480p': 4, '720p': 8, '1080p': 15 },
    capabilities: {
      provider: 'fal',
      modelKey: 'wan-3-0',
      displayName: 'Wan 3.0',
      status: 'preview',
      kind: 'video',
      sizing: { mode: 'aspect', values: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      outputs: { min: 1, max: 1, default: 1 },
      duration: { values: [5, 10, 15], default: 5 },
      modes: { values: ['480p', '720p', '1080p'], default: '720p', labels: { '480p': '480p', '720p': '720p', '1080p': '1080p' } },
      refAddressing: 'ordinal',
      maxReferences: 10,
      maxSubjects: 10,
      maxImagesTotal: 10,
      acceptsStartEndImage: true,
      maxPromptChars: 2500,
      notes: 'Alibaba Wan 3.0 via fal: text, start/end frame, or up to 10 reference images; native audio.',
      fal: {
        endpoints: {
          text: 'alibaba/wan-3.0/text-to-video',
          image: 'alibaba/wan-3.0/image-to-video',
          reference: 'alibaba/wan-3.0/reference-to-video',
        },
        input: {
          prompt: 'prompt',
          aspectRatio: { field: 'aspect_ratio' },
          mode: { field: 'resolution' },
          duration: { field: 'duration', as: 'number' },
          imageUrl: 'start_image_url',
          endImageUrl: 'end_image_url',
          referenceImages: { field: 'reference_image_urls', max: 10 },
          seed: 'seed',
          extra: { audio: true, enable_safety_checker: true },
        },
      },
    },
  },
  // ── fal: FLUX 3 Image — $0.048 at 1K, $0.10 at 2K, $0.607 at 4K (regular) ──
  {
    provider: 'fal',
    modelKey: 'flux-3-image',
    displayName: 'FLUX 3',
    costPerCallUsd: '0.0480',
    costCredits: 1,
    tierPricing: { '1k': 1, '2k': 2, '4k': 10 },
    capabilities: {
      provider: 'fal',
      modelKey: 'flux-3-image',
      displayName: 'FLUX 3',
      status: 'preview',
      kind: 'image',
      sizing: { mode: 'aspect', values: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] },
      outputs: { min: 1, max: 1, default: 1 },
      modes: { values: ['1k', '2k', '4k'], default: '1k', labels: { '1k': '1K', '2k': '2K', '4k': '4K' } },
      refAddressing: 'ordinal',
      maxReferences: 10,
      maxSubjects: 10,
      maxImagesTotal: 10,
      maxPromptChars: 2500,
      notes: 'Black Forest Labs FLUX 3 via fal: text-to-image, or edit with up to 10 reference images.',
      fal: {
        endpoints: {
          text: 'blackforestlabs/flux-3/text-to-image',
          reference: 'blackforestlabs/flux-3/edit-image',
        },
        input: {
          prompt: 'prompt',
          aspectRatio: { field: 'aspect_ratio' },
          mode: { field: 'resolution' },
          referenceImages: { field: 'image_urls', max: 10 },
          extra: { output_format: 'jpeg' },
        },
      },
    },
  },
  // ── fal: FLUX 3 Video — $0.17/s 720p, $0.29/s 1080p; 5 s default ──
  {
    provider: 'fal',
    modelKey: 'flux-3-video',
    displayName: 'FLUX 3 Video',
    costPerCallUsd: '0.8500',
    costCredits: 13,
    tierPricing: { '720p': 13, '1080p': 22 },
    capabilities: {
      provider: 'fal',
      modelKey: 'flux-3-video',
      displayName: 'FLUX 3 Video',
      status: 'preview',
      kind: 'video',
      sizing: { mode: 'aspect', values: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] },
      outputs: { min: 1, max: 1, default: 1 },
      duration: { values: [5, 8, 10], default: 5 },
      modes: { values: ['720p', '1080p'], default: '720p', labels: { '720p': '720p', '1080p': '1080p' } },
      refAddressing: 'ordinal',
      maxReferences: 0,
      maxSubjects: 1,
      maxImagesTotal: 1,
      maxPromptChars: 2500,
      notes: 'Black Forest Labs FLUX 3 Video via fal: text or one start image; audio with lip-sync.',
      fal: {
        endpoints: {
          text: 'blackforestlabs/flux-3/text-to-video',
          image: 'blackforestlabs/flux-3/image-to-video',
        },
        input: {
          prompt: 'prompt',
          aspectRatio: { field: 'aspect_ratio' },
          mode: { field: 'resolution' },
          duration: { field: 'duration', as: 'string' },
          imageUrl: 'image_url',
          extra: { generate_audio: true },
        },
      },
    },
  },
  // ── fal: MiniMax H3 Max — $0.05 / $0.08 / $0.16 per second (regular); 5 s default ──
  {
    provider: 'fal',
    modelKey: 'h3-max',
    displayName: 'MiniMax H3 Max',
    costPerCallUsd: '0.4000',
    costCredits: 6,
    tierPricing: { '480P': 4, '768P': 6, '1080P': 12 },
    capabilities: {
      provider: 'fal',
      modelKey: 'h3-max',
      displayName: 'MiniMax H3 Max',
      status: 'preview',
      kind: 'video',
      sizing: { mode: 'aspect', values: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] },
      outputs: { min: 1, max: 1, default: 1 },
      duration: { values: [5, 8, 10, 15], default: 5 },
      modes: { values: ['480P', '768P', '1080P'], default: '768P', labels: { '480P': '480p', '768P': '768p', '1080P': '1080p' } },
      refAddressing: 'ordinal',
      maxReferences: 12,
      maxSubjects: 12,
      maxImagesTotal: 12,
      acceptsStartEndImage: true,
      maxPromptChars: 7000,
      notes: 'MiniMax H3 Max via fal: text, start/end frame, or reference images; native audio.',
      fal: {
        endpoints: {
          text: 'minimax/h3-max/text-to-video',
          image: 'minimax/h3-max/image-to-video',
          reference: 'minimax/h3-max/reference-to-video',
        },
        input: {
          prompt: 'prompt',
          // image-to-video has no aspect_ratio field (the frame decides).
          aspectRatio: { field: 'aspect_ratio', tasks: ['text', 'reference'] },
          mode: { field: 'resolution' },
          duration: { field: 'duration', as: 'number' },
          imageUrl: 'image_url',
          endImageUrl: 'end_image_url',
          referenceImages: { field: 'reference_image_urls', max: 12 },
          seed: 'seed',
          extra: { prompt_expansion_mode: 'balanced', enable_safety_checker: true },
        },
      },
    },
  },
];

async function main() {
  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'}${reprice ? ' (+reprice)' : ''} — ${new URL(url!).host}\n`);
  for (const row of ROWS) {
    if (row.provider === 'fal') {
      const parsed = falModelCapabilitiesSchema.safeParse(row.capabilities);
      if (!parsed.success) {
        console.error(`✗ ${row.modelKey}: capabilities invalid`, parsed.error.issues.slice(0, 5));
        process.exit(2);
      }
      row.capabilities = parsed.data as Record<string, unknown>;
    }
    const existing = await db.query.providerModels.findFirst({
      where: and(eq(providerModels.provider, row.provider), eq(providerModels.modelKey, row.modelKey)),
    });
    const action = existing ? (reprice ? 'update + reprice' : 'update capabilities only') : 'insert (preview)';
    console.log(`  ${row.provider.padEnd(7)} ${row.modelKey.padEnd(26)} ${action.padEnd(26)} ${row.costCredits} cr  ${JSON.stringify(row.tierPricing)}`);
    if (!apply) continue;

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
        updatedAt: new Date(),
      });
    } else {
      await db
        .update(providerModels)
        .set({
          displayName: row.displayName,
          // Keep the row's own status inside the blob in step.
          capabilities: { ...row.capabilities, status: existing.status, displayName: row.displayName },
          ...(reprice
            ? { costPerCallUsd: row.costPerCallUsd, costCredits: row.costCredits, tierPricing: row.tierPricing }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(providerModels.id, existing.id));
    }
  }
  console.log(apply ? '\nDone.' : '\nDry run — nothing written. Re-run with --apply.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
