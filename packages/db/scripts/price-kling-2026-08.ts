/**
 * Pricing pass — the Kling video roster, August 2026.
 *
 * Priced against Kuaishou's own published rate card
 * (kling.ai/document-api/pricing/base/video, read 2026-08-23), which
 * bills PER SECOND. Every figure below is therefore
 *
 *     credits = $/second × default_duration(5s) × 300
 *
 * where 300 is the house anchor: 1 credit = $0.01, ~3.0x markup. That
 * is the same rule `price-models-2026-08.ts` used (Seedance 2.0:
 * $0.76 → 228cr), so the catalogue stays internally consistent.
 *
 * WHY THIS PASS EXISTS
 *
 *   🔴 Kling 3.0 and 3.0 Omni were LOSS-MAKING at 4K: 188cr and 198cr
 *      of revenue against $2.10 of cost — we paid ~$0.22 for every 4K
 *      second generated. No published template pins 4K today, so this
 *      closes future exposure rather than a live leak.
 *   🟠 Both were also ~1.7x at their other tiers, against a 3.0x rule.
 *   🟠 kling-v2-master sat at 0 credits, which the API refuses to run
 *      (`template_unpriced`) — priced, so it becomes usable.
 *   🟢 2.6 and 2.5 Turbo gained selectable 720p/1080p tiers, so they
 *      need `tier_pricing` rows for the first time.
 *
 * TIER DEFAULTS AND WHY THEY MATTER
 *
 * `cost_credits` mirrors the tier named as `modes.default` in the code
 * registry. For 2.6 / 2.5 Turbo that default is deliberately `std`
 * (720p): the compiler sends `modes.default` whenever a stage does not
 * pin `config.mode`, so defaulting to `pro` would silently start
 * generating 1080p for the 47 published templates on those models —
 * doubling our cost while their price stays frozen at publish time.
 *
 * AUDIO IS NOT PRICED HERE
 *
 * Kling charges MORE per second with native audio (3.0 @1080p:
 * $0.112 → $0.168). `tier_pricing` is keyed by tier alone, so a job
 * with sound on runs at ~2.0x instead of 3.0x. Still profitable, never
 * a loss — but it is a real margin compression and wants its own
 * pricing dimension. Deliberately out of scope for this pass.
 *
 * SAFETY
 *   - UPDATE only. No DELETE, no TRUNCATE, no DDL. Every statement is
 *     scoped to one (provider, model_key) pair.
 *   - Refuses to run unless every target row already exists; it will
 *     not create rows (that is `db:seed-models`' job).
 *   - Prints a before/after diff and re-reads from the database to
 *     confirm, rather than trusting the write.
 *   - `--apply` is required; the default is a dry run.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/price-kling-2026-08.ts            # dry run
 *   DATABASE_URL=... pnpm tsx scripts/price-kling-2026-08.ts --apply
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);

/** House anchor: 1 credit = $0.01, 3.0x markup ⇒ $1.00 of cost = 300cr. */
const CREDITS_PER_USD = 300;
/** Every Kling model defaults to a 5-second clip. */
const DEFAULT_SECONDS = 5;

const cr = (usdPerSecond: number) =>
  Math.round(usdPerSecond * DEFAULT_SECONDS * CREDITS_PER_USD);

interface Target {
  modelKey: string;
  /** Tier key → provider $/second at that resolution (no native audio). */
  perSecond: Record<string, number>;
  /** Tier whose price becomes `cost_credits`; must match `modes.default`. */
  defaultTier: string | null;
  why: string;
}

const TARGETS: Target[] = [
  // ── Kling 3.0 ───────────────────────────────────────────────────
  {
    modelKey: 'kling-v3',
    perSecond: { std: 0.084, pro: 0.112, '4k': 0.42 },
    defaultTier: 'pro',
    why: '4k was 188cr vs $2.10 cost — a loss. std/pro were ~1.7x.',
  },
  {
    modelKey: 'kling-v3-omni',
    // "No video input" column; reference VIDEOS cost more ($0.126/s at
    // 720p) but we do not send them yet.
    perSecond: { std: 0.084, pro: 0.112, '4k': 0.42 },
    defaultTier: 'pro',
    why: '4k was 198cr vs $2.10 cost — a loss. std/pro were ~2.0x.',
  },
  // ── Kling 3.0 Turbo (new) ───────────────────────────────────────
  {
    modelKey: 'kling-v3-turbo',
    // The rate card lists Turbo only in its "With Native Audio" row, so
    // that is the rate we pay whether or not we ask for sound.
    perSecond: { std: 0.112, pro: 0.14 },
    defaultTier: 'std',
    why: 'new model, previously unpriced',
  },
  // ── Kling O1 (new) ──────────────────────────────────────────────
  {
    modelKey: 'kling-o1',
    perSecond: { std: 0.084, pro: 0.112 },
    defaultTier: 'std',
    why: 'new model, previously unpriced',
  },
  // ── Kling 2.6 ───────────────────────────────────────────────────
  {
    modelKey: 'kling-v2-6',
    perSecond: { std: 0.042, pro: 0.07 },
    defaultTier: 'std',
    why: 'gained 720p/1080p tiers; base moves to the 720p it already generates',
  },
  // ── Kling 2.5 Turbo ─────────────────────────────────────────────
  {
    modelKey: 'kling-v2-5-turbo',
    perSecond: { std: 0.042, pro: 0.07 },
    defaultTier: 'std',
    why: 'gained 720p/1080p tiers; base moves to the 720p it already generates',
  },
  // ── Kling 2 Master ──────────────────────────────────────────────
  {
    modelKey: 'kling-v2-master',
    // 1080p only on the rate card — no tier list, so a flat price.
    perSecond: { flat: 0.28 },
    defaultTier: null,
    why: 'was 0 credits, which the API refuses to run (template_unpriced)',
  },
];

interface Row {
  model_key: string;
  cost_credits: number;
  tier_pricing: Record<string, number> | null;
  cost_per_call_usd: string | null;
}

/** Value-wise compare — jsonb round-trips reorder keys, so JSON.stringify lies. */
function sameTiers(
  a: Record<string, number> | null,
  b: Record<string, number> | null,
): boolean {
  if (a === null || b === null) return a === b;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => a[k] === b[k]);
}

async function main() {
  const host = url!.split('@')[1]?.split('/')[0] ?? 'unknown';
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — ${host}\n`);

  const existing = (await sql`
    SELECT model_key, cost_credits, tier_pricing, cost_per_call_usd
    FROM provider_models WHERE provider = 'kling'
  `) as Row[];
  const byKey = new Map(existing.map((r) => [r.model_key, r]));

  // Fail closed: a missing row means the registry and the database have
  // drifted, and creating one here would bypass the seed script's
  // capability sync.
  const missing = TARGETS.filter((t) => !byKey.has(t.modelKey)).map((t) => t.modelKey);
  if (missing.length > 0) {
    console.error(`✗ these rows do not exist yet — run \`pnpm db:seed-models\` first:`);
    for (const m of missing) console.error(`    kling/${m}`);
    process.exit(1);
  }

  let changed = 0;
  for (const t of TARGETS) {
    const row = byKey.get(t.modelKey)!;

    const tiers =
      t.defaultTier === null
        ? null
        : Object.fromEntries(Object.entries(t.perSecond).map(([k, v]) => [k, cr(v)]));
    const base =
      t.defaultTier === null
        ? cr(t.perSecond.flat!)
        : cr(t.perSecond[t.defaultTier]!);
    // Provider cost of one default-tier, default-duration call.
    const usd = (
      (t.defaultTier === null ? t.perSecond.flat! : t.perSecond[t.defaultTier]!) *
      DEFAULT_SECONDS
    ).toFixed(4);

    const noop =
      row.cost_credits === base &&
      sameTiers(row.tier_pricing, tiers) &&
      Number(row.cost_per_call_usd) === Number(usd);

    const arrow = noop ? '=' : '→';
    console.log(`${noop ? ' ' : '•'} ${t.modelKey}`);
    console.log(
      `    base   ${String(row.cost_credits).padStart(4)} ${arrow} ${String(base).padStart(4)} cr` +
        `   (\$${usd} cost @ ${t.defaultTier ?? 'flat'}/${DEFAULT_SECONDS}s → ${(
          (base / 100) /
          Number(usd)
        ).toFixed(1)}x)`,
    );
    console.log(
      `    tiers  ${JSON.stringify(row.tier_pricing)} ${arrow} ${JSON.stringify(tiers)}`,
    );
    if (!noop) console.log(`    why    ${t.why}`);

    if (!noop) changed += 1;
    if (!apply || noop) continue;

    await sql`
      UPDATE provider_models
      SET cost_credits = ${base},
          tier_pricing = ${tiers === null ? null : JSON.stringify(tiers)}::jsonb,
          cost_per_call_usd = ${usd},
          updated_at = now()
      WHERE provider = 'kling' AND model_key = ${t.modelKey}
    `;
  }

  console.log(`\n${changed} row(s) ${apply ? 'updated' : 'would change'}.`);
  if (!apply) {
    console.log('Re-run with --apply to write.');
    return;
  }

  // Read back rather than trusting the write.
  console.log('\nVerifying from the database:');
  const after = (await sql`
    SELECT model_key, cost_credits, tier_pricing
    FROM provider_models WHERE provider = 'kling' ORDER BY model_key
  `) as Row[];
  let bad = 0;
  for (const t of TARGETS) {
    const row = after.find((r) => r.model_key === t.modelKey)!;
    const tiers =
      t.defaultTier === null
        ? null
        : Object.fromEntries(Object.entries(t.perSecond).map(([k, v]) => [k, cr(v)]));
    const base =
      t.defaultTier === null ? cr(t.perSecond.flat!) : cr(t.perSecond[t.defaultTier]!);
    const ok = row.cost_credits === base && sameTiers(row.tier_pricing, tiers);
    if (!ok) bad += 1;
    console.log(
      `  ${ok ? '✓' : '✗'} ${t.modelKey.padEnd(18)} ${String(row.cost_credits).padStart(4)}cr  ${JSON.stringify(row.tier_pricing)}`,
    );
  }
  console.log(bad === 0 ? '\n✔ all rows match.' : `\n✗ ${bad} row(s) did not match.`);
  if (bad > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
