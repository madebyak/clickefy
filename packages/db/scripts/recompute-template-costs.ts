/**
 * One-off backfill — recompute `templates.cost_credits` tier-aware.
 *
 * Why: Seedance stages authored before the editor wrote `config.mode`
 * stored their quality tier in `config.resolution`, while costing only
 * read `config.mode` — so a 1080p/4k stage generated at that tier but
 * billed the flat base. The API now falls back to `resolution`
 * (apps/api/src/lib/template-cost.ts); this script re-prices templates
 * that were saved under the old rule. Safe to re-run any time the
 * costing rule and stored totals could have drifted.
 *
 * Mirrors `computeTemplateCost` deliberately: tier = mode ?? resolution,
 * cost comes from `resolveCreditCost` — the same helper the API's own
 * template costing uses — so tier, duration and native audio are all
 * applied. Unknown models cost 0.
 *
 * SAFETY
 *   - UPDATE only, scoped to templates whose recomputed total differs.
 *   - Prints a before/after diff per template; `--apply` required, the
 *     default is a dry run.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/recompute-template-costs.ts          # dry run
 *   DATABASE_URL=... pnpm tsx scripts/recompute-template-costs.ts --apply
 */

import { neon } from '@neondatabase/serverless';
import { findCapabilities } from '@clickfy/providers';
import { resolveCreditCost } from '@clickfy/types';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);

interface StageJson {
  provider?: string;
  model?: string;
  config?: { mode?: unknown; resolution?: unknown; duration?: unknown; sound?: unknown };
}

async function main() {
  const models = (await sql`
    SELECT provider, model_key, cost_credits, tier_pricing
    FROM provider_models
  `) as Array<{
    provider: string;
    model_key: string;
    cost_credits: number;
    tier_pricing: Record<string, number> | null;
  }>;
  const priceByKey = new Map(models.map((m) => [`${m.provider}/${m.model_key}`, m]));

  const templates = (await sql`
    SELECT id, title, cost_credits, generation
    FROM templates
  `) as Array<{
    id: string;
    title: string;
    cost_credits: number;
    generation: { stages?: StageJson[] } | null;
  }>;

  let drifted = 0;
  for (const t of templates) {
    const stages = t.generation?.stages ?? [];
    let total = 0;
    for (const s of stages) {
      const row = priceByKey.get(`${s.provider}/${s.model}`);
      if (!row) continue;
      const cfg = s.config ?? {};
      const tierKey =
        typeof cfg.mode === 'string'
          ? cfg.mode
          : typeof cfg.resolution === 'string'
            ? cfg.resolution
            : undefined;
      // Duration and audio, exactly as `apps/api/src/lib/template-cost.ts`
      // computes them. This script used to take the tier price alone, so a
      // template pinning a 10-second clip was recomputed at the 5-second
      // price — and the API would then charge the other number. Two rules
      // for one price is how a catalogue drifts.
      const caps = findCapabilities(s.model);
      const refDuration = caps?.kind === 'video' ? caps.duration?.default : undefined;
      const cfgDuration = typeof cfg.duration === 'number' ? cfg.duration : undefined;
      const cfgSound = cfg.sound === true || cfg.sound === 'on';
      const soundServed =
        cfgSound &&
        caps?.supportsSound === true &&
        !(caps.nativeAudioRequiresTier && tierKey !== caps.nativeAudioRequiresTier);
      total += resolveCreditCost({
        baseCredits: row.cost_credits,
        tierPricing: row.tier_pricing,
        mode: tierKey,
        sound: soundServed,
        duration: cfgDuration ?? refDuration,
        defaultDuration: refDuration,
      });
    }

    if (total === t.cost_credits) continue;
    drifted += 1;
    console.log(
      `${apply ? 'UPDATE' : 'would update'}  ${t.id}  "${t.title}"  ${t.cost_credits} -> ${total}cr`,
    );
    if (apply) {
      await sql`
        UPDATE templates
        SET cost_credits = ${total}, updated_at = now()
        WHERE id = ${t.id}
      `;
    }
  }

  console.log(
    `\n${templates.length} templates checked, ${drifted} ${apply ? 'updated' : 'would change'}.` +
      (apply || drifted === 0 ? '' : ' Re-run with --apply to write.'),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
