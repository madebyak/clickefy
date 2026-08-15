/**
 * Seed script — populates `provider_models` from the
 * `MODEL_CAPABILITIES` registry in `@clickfy/providers`.
 *
 * Why a script (not an admin "Add model" button):
 *   Rows in `provider_models` are only meaningful if they match a
 *   real model entry in `MODEL_CAPABILITIES` — the prompt-compiler and
 *   runtime adapters key off `(provider, model_key)` at job time, and
 *   an inventable row would just crash dispatch with
 *   `Unknown model "..."`. Keeping creation seed-driven means the
 *   capability registry stays the single source of truth and the admin
 *   UI is intentionally limited to pricing the rows that exist.
 *
 * Idempotency + UPSERT semantics:
 *   Keyed on the existing `(provider, model_key)` unique index. On
 *   re-run, we UPDATE non-pricing columns (`display_name`, `status`,
 *   `capabilities`, `default_fallback_model_key`, `cost_per_call_usd`)
 *   so capability changes propagate cleanly, but we DO NOT touch
 *   `cost_credits` — that's the admin-controlled column the dashboard
 *   writes to, and clobbering it on every re-seed would silently
 *   reset prices the operator carefully set.
 *
 *   Net effect:
 *     - First run on a fresh DB: all models inserted with
 *       cost_credits = 0 → they show up in the admin UI as "unpriced"
 *       (the existing amber-highlighted row) → admin prices them.
 *     - Subsequent runs after a registry change: capabilities & USD
 *       reference cost refresh; admin-set credit prices stay intact.
 *
 * Excluded entries:
 *   `gpt-image-2` is a forward-looking stub in the registry (provider
 *   is set to 'gemini' as a placeholder until the OpenAI runtime
 *   adapter and 'openai' provider enum value land). Seeding it would
 *   pollute the admin list with a non-functional row.
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @clickfy/db db:seed-models
 *
 * The starter `cost_per_call_usd` values below are best-effort
 * estimates from each provider's published pricing at the time of
 * writing. They are operator reference values shown in the admin
 * table — they do NOT affect billing (only `cost_credits` does).
 * Verify against current provider invoices before relying on them
 * for margin analysis.
 */

import { sql } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import { MODEL_CAPABILITIES } from '@clickfy/providers';

import * as schema from '../src/schema';
import { providerModels } from '../src/schema';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const neonSql = neon(url);
const db = drizzle(neonSql, { schema });

/**
 * Models in `MODEL_CAPABILITIES` that should NOT be inserted into
 * `provider_models`. Anything listed here is either a placeholder
 * (provider doesn't really match) or otherwise not wired end-to-end.
 */
const EXCLUDED_MODEL_KEYS = new Set<string>([
  // Placeholder entry — provider is set to 'gemini' as a hack until
  // the OpenAI runtime adapter ships and the `provider` enum gains
  // an 'openai' value. Seeding it would create a row that crashes
  // at dispatch time if accidentally referenced.
  'gpt-image-2',
]);

/**
 * USD reference cost per call, keyed by `${provider}/${modelKey}`.
 * Used purely for the operator-facing "USD / call" column in the
 * admin UI. Pricing the user pays is controlled by `cost_credits`,
 * which this script intentionally does NOT set.
 */
const COST_PER_CALL_USD: Record<string, string> = {
  // Gemini image — Google AI Studio published prices, re-checked
  // 2026-08-15. Values are the model's CHEAPEST tier (1K, except Lite
  // which is 1K-only and NB2 which also does 0.5K); higher resolutions
  // cost more and are priced per tier in `tier_pricing`:
  //   NB Pro  1K/2K $0.134 · 4K $0.24
  //   NB2     0.5K $0.045 · 1K $0.067 · 2K $0.101 · 4K $0.151
  //   Lite    1K $0.0336 (only tier)
  'gemini/gemini-3-pro-image': '0.1340',
  'gemini/gemini-3.1-flash-image': '0.0670',
  'gemini/gemini-3.1-flash-lite-image': '0.0336',

  // Legacy preview keys — same upstream models via `apiModelId`, so the
  // same true cost. Kept for templates that still reference them.
  'gemini/gemini-2.5-flash-image': '0.0390',
  'gemini/gemini-3.1-flash-image-preview': '0.0670',
  'gemini/gemini-3-pro-image-preview': '0.1340',

  // Imagen 4 — Google AI Studio published prices.
  'gemini/imagen-4.0-generate-001': '0.0400',
  'gemini/imagen-4.0-fast-generate-001': '0.0200',

  // Kling video — Kuaishou published prices for 5s 1080p output.
  'kling/kling-v2-5-turbo': '0.3500',
  'kling/kling-v2-6': '0.4900',
  'kling/kling-v2-master': '1.4000',
  'kling/kling-v3-omni': '0.4900',

  // Seedance 2.0 (BytePlus ModelArk) — published reference prices
  // for 5s clips at 720p. 1080p is ~2x; 2K higher still. These are
  // operator-facing reference values only — what the user pays in
  // credits is set via the admin "Model pricing" page.
  'seedance/dreamina-seedance-2-0-260128': '0.4700',
  'seedance/dreamina-seedance-2-0-fast-260128': '0.3700',
};

interface ModelRow {
  provider: 'gemini' | 'kling' | 'veo' | 'seedance';
  modelKey: string;
  displayName: string;
  status: 'active' | 'preview' | 'deprecated';
  capabilities: Record<string, unknown>;
  costPerCallUsd: string;
}

function buildRows(): ModelRow[] {
  const rows: ModelRow[] = [];
  for (const cap of Object.values(MODEL_CAPABILITIES)) {
    if (EXCLUDED_MODEL_KEYS.has(cap.modelKey)) continue;

    const key = `${cap.provider}/${cap.modelKey}`;
    const usd = COST_PER_CALL_USD[key] ?? '0.0000';

    // The capabilities JSON we store IS the registry entry — admin
    // UI deserializes it for model-aware form controls. We stringify
    // through JSON to drop function-valued fields (there are none
    // today, but it future-proofs against accidental closures
    // leaking into the row).
    const capabilitiesJson = JSON.parse(JSON.stringify(cap)) as Record<string, unknown>;

    rows.push({
      provider: cap.provider as 'gemini' | 'kling' | 'veo' | 'seedance',
      modelKey: cap.modelKey,
      displayName: cap.displayName,
      status: cap.status,
      capabilities: capabilitiesJson,
      costPerCallUsd: usd,
    });
  }
  return rows;
}

async function main() {
  const before = await db.select({ id: providerModels.id }).from(providerModels);
  console.log(`Before: ${before.length} provider_models row(s)`);

  const rows = buildRows();
  console.log(`\nUpserting ${rows.length} models from MODEL_CAPABILITIES…`);

  // One INSERT per row so we can request per-row `onConflictDoUpdate`
  // behaviour. The table is tiny (under ~20 rows) so the round-trip
  // overhead is negligible, and the alternative — building a single
  // multi-row INSERT with a VALUES list — gives us less control over
  // which columns are excluded from the UPDATE clause.
  //
  // CRITICAL: `cost_credits` is NOT in the SET clause. It belongs to
  // the operator (admin UI). Re-running this script must NEVER
  // clobber a price the admin set — see header comment.
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await db
      .select({ id: providerModels.id })
      .from(providerModels)
      .where(
        sql`${providerModels.provider} = ${row.provider} AND ${providerModels.modelKey} = ${row.modelKey}`,
      );
    const isNew = existing.length === 0;

    await db
      .insert(providerModels)
      .values({
        provider: row.provider,
        modelKey: row.modelKey,
        displayName: row.displayName,
        status: row.status,
        capabilities: row.capabilities,
        costPerCallUsd: row.costPerCallUsd,
        // costCredits intentionally omitted → schema default (0)
        // takes effect on insert. Admin sets the real price via the
        // dashboard.
      })
      .onConflictDoUpdate({
        target: [providerModels.provider, providerModels.modelKey],
        set: {
          displayName: row.displayName,
          status: row.status,
          capabilities: row.capabilities,
          costPerCallUsd: row.costPerCallUsd,
          updatedAt: new Date(),
        },
      });

    if (isNew) inserted += 1;
    else updated += 1;
  }

  const after = await db
    .select({
      provider: providerModels.provider,
      modelKey: providerModels.modelKey,
      displayName: providerModels.displayName,
      status: providerModels.status,
      costCredits: providerModels.costCredits,
      costPerCallUsd: providerModels.costPerCallUsd,
    })
    .from(providerModels)
    .orderBy(providerModels.provider, providerModels.modelKey);

  console.log(`\nAfter: ${after.length} row(s) — ${inserted} inserted, ${updated} updated`);
  for (const m of after) {
    const priced = m.costCredits > 0 ? `${m.costCredits} credits` : 'UNPRICED';
    console.log(
      `  • [${m.provider}] ${m.modelKey.padEnd(34)} $${m.costPerCallUsd}/call · ${priced} · ${m.status}`,
    );
  }

  const unpriced = after.filter((m) => m.costCredits === 0).length;
  if (unpriced > 0) {
    console.log(
      `\n${unpriced} model(s) still UNPRICED. Set credit prices in the admin dashboard:`,
    );
    console.log('  → Credits → Model pricing → click the pencil per row.');
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
