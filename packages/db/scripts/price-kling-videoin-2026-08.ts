/**
 * One-off pricing pass — Kling video-input tiers.
 *
 * WHY: Kling bills any request carrying an input/reference video
 * (`base_video` / `feature_video` on the omni endpoints) at a flat
 * higher per-second rate — 0.9/1.2 U/s vs 0.6/0.8 silent, exactly 1.5x
 * on both tiers, independent of the input clip's length (official rate
 * card, kling.ai Pricing → Video, read 2026-08-30; 4K is 3.0 U/s either
 * way, so it gets no key). The resolver reads `${tier}_videoin` keys
 * from tier_pricing (see `@clickfy/types/pricing.ts`); this script adds
 * them for the two models whose endpoints accept video input. The keys
 * are additive and INERT until the create flow actually sends a video —
 * phase 2 of the reference/edit work.
 *
 * Derived from each row's CURRENT silent tier price (the two databases
 * are deliberately on different markups — prod ~2.0x, dev branch 3.0x),
 * so the keys inherit whatever markup their row is on. Existing keys,
 * including the `_audio` ones, are preserved verbatim.
 *
 * SAFETY: UPDATE only, scoped per (provider, model_key); aborts if a
 * source tier is missing; dry run by default; re-reads to verify.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/price-kling-videoin-2026-08.ts            # dry run
 *   DATABASE_URL=... pnpm tsx scripts/price-kling-videoin-2026-08.ts --apply
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);

/** Video-in key ← silent key × (num / den), rounded up. */
const TIERS: Array<{
  modelKey: string;
  videoIn: Array<{ from: string; num: number; den: number }>;
  why: string;
}> = [
  {
    // /omni-video/kling-3.0-omni — base_video / feature_video.
    modelKey: 'kling-v3-omni',
    videoIn: [
      { from: 'std', num: 3, den: 2 },
      { from: 'pro', num: 3, den: 2 },
    ],
    why: 'video-in 0.9/1.2 U/s vs 0.6/0.8 silent; 4k unchanged at 3.0',
  },
  {
    // /omni-video/kling-o1 — same roles, same 1.5x, no 4k tier at all.
    modelKey: 'kling-o1',
    videoIn: [
      { from: 'std', num: 3, den: 2 },
      { from: 'pro', num: 3, den: 2 },
    ],
    why: 'video-in 0.9/1.2 U/s vs 0.6/0.8 silent',
  },
];

type PricingRow = { tier_pricing: Record<string, number> | null };

async function readRow(modelKey: string): Promise<PricingRow | null> {
  const rows = (await sql(
    `select tier_pricing from provider_models
      where provider = 'kling' and model_key = $1`,
    [modelKey],
  )) as unknown as PricingRow[];
  return rows[0] ?? null;
}

async function main() {
  const host = new URL(url!.replace('postgresql://', 'https://')).hostname;
  console.log(`Target: ${host}`);
  console.log(apply ? 'Mode:   APPLY\n' : 'Mode:   DRY RUN (pass --apply to write)\n');

  console.log('Video-input tier pricing:');
  for (const t of TIERS) {
    const row = await readRow(t.modelKey);
    if (!row) {
      console.error(`ABORT — kling/${t.modelKey} row does not exist.`);
      process.exit(1);
    }
    const current = row.tier_pricing ?? {};
    const missingSrc = t.videoIn.filter((v) => typeof current[v.from] !== 'number');
    if (missingSrc.length > 0) {
      console.error(
        `ABORT — kling/${t.modelKey} is missing silent tier(s) ` +
          `${missingSrc.map((v) => v.from).join(', ')}: db=${JSON.stringify(current)}`,
      );
      process.exit(1);
    }
    const desired: Record<string, number> = { ...current };
    for (const v of t.videoIn) {
      desired[`${v.from}_videoin`] = Math.ceil((current[v.from]! * v.num) / v.den);
    }
    const want = JSON.stringify(desired);
    const same =
      Object.keys(current).length === Object.keys(desired).length &&
      Object.keys(desired).every((k) => current[k] === desired[k]);
    if (same) {
      console.log(`  =  ${t.modelKey.padEnd(16)} already ${want}`);
      continue;
    }
    if (apply) {
      await sql(
        `update provider_models set tier_pricing = $1::jsonb, updated_at = now()
          where provider = 'kling' and model_key = $2`,
        [want, t.modelKey],
      );
      const after = await readRow(t.modelKey);
      const ok =
        after?.tier_pricing != null &&
        Object.keys(desired).every((k) => after.tier_pricing![k] === desired[k]) &&
        Object.keys(after.tier_pricing).length === Object.keys(desired).length;
      console.log(`  ${ok ? '✓' : '✗ MISMATCH'}  ${t.modelKey.padEnd(16)} ${want}   (${t.why})`);
    } else {
      console.log(
        `  ·  ${t.modelKey.padEnd(16)} ${JSON.stringify(current)} → ${want}   (${t.why})`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
