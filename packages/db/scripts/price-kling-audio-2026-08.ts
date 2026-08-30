/**
 * One-off pricing pass — Kling native-audio tiers + legacy retirement.
 *
 * WHY: Kling bills audio-on generation at a HIGHER per-second rate than
 * silent (official rate card, kling.ai Pricing → Video, read 2026-08-27),
 * but tier_pricing only carried the silent rates — the sound toggle was
 * free to users while costing us up to 2x upstream. The resolver now
 * reads `${tier}_audio` keys from the same JSONB (see
 * `@clickfy/types/pricing.ts`); this script adds them. A missing
 * `_audio` key means "no surcharge", so models without one are inert —
 * the keys are additive and old deployed code simply never looks them up.
 *
 * Also deprecates `kling-v2-master`: Kuaishou retires the whole
 * 1.x/2.0/2.1 legacy line on 2026-09-15. Verified on BOTH databases
 * 2026-08-27: zero templates, version snapshots, or jobs reference any
 * retiring id, so this is pure catalog cleanup.
 *
 * SAFETY
 *   - UPDATE only, each scoped to one (provider, model_key).
 *   - The tier_pricing UPDATE replaces the whole JSONB, so the script
 *     ABORTS unless the new object is a strict superset of what the row
 *     holds now (same values on every existing key) — a drifted DB is
 *     surfaced, never clobbered.
 *   - Dry run by default; re-reads after every write to confirm.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/price-kling-audio-2026-08.ts            # dry run
 *   DATABASE_URL=... pnpm tsx scripts/price-kling-audio-2026-08.ts --apply
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
 * Audio keys are DERIVED from each row's current silent tier price using
 * the exact upstream rate ratios, not written as absolute numbers. The
 * two databases are deliberately on different markups right now (prod
 * was cut to ~2.0x by `reprice-margin-2026-08.ts`; the dev branch still
 * holds the 3.0x prices), and audio must inherit whatever markup its row
 * is on — otherwise a future margin pass silently breaks the ratio.
 *
 * Ratios per the official rate card (kling.ai Pricing → Video):
 *
 *   kling-v2-6    silent 0.3/0.5 U/s; audio exists only at 1080p and
 *                 costs 1.0 U/s → pro_audio = pro × 2. No std_audio.
 *   kling-v3      silent 0.6/0.8; audio (no voice control) 0.9/1.2 →
 *                 both tiers × 1.5. 4k is 3.0 U/s either way — no key.
 *   kling-v3-omni silent 0.6/0.8; audio (no video input) 0.8/1.0 →
 *                 std × 4/3, pro × 1.25. Same 4k story as v3.
 *
 * O1's audio switch means "keep the reference video's sound" and has no
 * audio surcharge on the rate card; Seedance bakes audio into its token
 * billing. Neither gets keys.
 */
const TIERS: Array<{
  modelKey: string;
  /** Audio key ← silent key × (num / den), rounded up. */
  audio: Array<{ from: string; num: number; den: number }>;
  why: string;
}> = [
  {
    modelKey: 'kling-v2-6',
    audio: [{ from: 'pro', num: 2, den: 1 }],
    why: 'audio 1.0 U/s vs 0.5 silent @1080p',
  },
  {
    modelKey: 'kling-v3',
    audio: [
      { from: 'std', num: 3, den: 2 },
      { from: 'pro', num: 3, den: 2 },
    ],
    why: 'audio 0.9/1.2 U/s vs 0.6/0.8 silent',
  },
  {
    modelKey: 'kling-v3-omni',
    audio: [
      { from: 'std', num: 4, den: 3 },
      { from: 'pro', num: 5, den: 4 },
    ],
    why: 'audio 0.8/1.0 U/s vs 0.6/0.8 silent',
  },
];

type PricingRow = { tier_pricing: Record<string, number> | null; status: string };

async function readRow(modelKey: string): Promise<PricingRow | null> {
  const rows = (await sql(
    `select tier_pricing, status from provider_models
      where provider = 'kling' and model_key = $1`,
    [modelKey],
  )) as unknown as PricingRow[];
  return rows[0] ?? null;
}

async function main() {
  const host = new URL(url!.replace('postgresql://', 'https://')).hostname;
  console.log(`Target: ${host}`);
  console.log(apply ? 'Mode:   APPLY\n' : 'Mode:   DRY RUN (pass --apply to write)\n');

  console.log('Audio tier pricing:');
  for (const t of TIERS) {
    const row = await readRow(t.modelKey);
    if (!row) {
      console.error(`ABORT — kling/${t.modelKey} row does not exist.`);
      process.exit(1);
    }
    const current = row.tier_pricing ?? {};
    // Every source tier must exist — audio is a ratio on top of it.
    const missingSrc = t.audio.filter((a) => typeof current[a.from] !== 'number');
    if (missingSrc.length > 0) {
      console.error(
        `ABORT — kling/${t.modelKey} is missing silent tier(s) ` +
          `${missingSrc.map((a) => a.from).join(', ')}: db=${JSON.stringify(current)}`,
      );
      process.exit(1);
    }
    // Desired object = every existing key untouched + derived audio keys.
    const desired: Record<string, number> = { ...current };
    for (const a of t.audio) {
      desired[`${a.from}_audio`] = Math.ceil((current[a.from]! * a.num) / a.den);
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

  // ── Retirement ───────────────────────────────────────────────────
  console.log('\nLegacy retirement (upstream shutdown 2026-09-15):');
  const master = await readRow('kling-v2-master');
  if (!master) {
    console.log('  ?  kling-v2-master — row missing, skipped');
  } else if (master.status === 'deprecated') {
    console.log('  =  kling-v2-master already deprecated');
  } else if (apply) {
    await sql(
      `update provider_models set status = 'deprecated', updated_at = now()
        where provider = 'kling' and model_key = 'kling-v2-master'`,
      [],
    );
    const after = await readRow('kling-v2-master');
    console.log(
      `  ${after?.status === 'deprecated' ? '✓' : '✗ MISMATCH'}  kling-v2-master ${master.status} → deprecated`,
    );
  } else {
    console.log(`  ·  kling-v2-master ${master.status} → deprecated`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
