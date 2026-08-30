/**
 * Compute a template's credit cost from its pipeline stages.
 *
 * Rule: cost = SUM of `provider_models.cost_credits` for every stage's
 * (provider, model_key). Stages whose model isn't registered (or has
 * a cost_credits of 0) contribute 0 — we never fail a save because
 * pricing isn't set yet, but the admin UI surfaces unpriced models
 * so the operator can resolve them.
 *
 * Why server-side (not in the admin form): the admin form *also*
 * shows a live total, but persisting whatever the form sent would let
 * a stale tab undercharge after the operator raised a model's price.
 * The API recomputes on every save so the row always reflects the
 * current pricing.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { providerModels, type Db } from '@clickfy/db';
import { resolveCreditCost } from '@clickfy/types';
import { findCapabilities } from '@clickfy/providers';

interface StageRef {
  provider: 'gemini' | 'kling' | 'veo' | 'seedance' | 'openai' | string;
  model: string;
  /**
   * Stage config — `config.mode` selects a quality tier (Kling std/pro/4k,
   * Gemini 1K/2K/4K, GPT Image low/medium/high). Seedance stages authored
   * before the editor wrote `mode` carry the tier in `config.resolution`
   * instead (same key space: 480p/720p/1080p/4k).
   */
  config?: Record<string, unknown>;
}

export interface TemplateCostBreakdown {
  total: number;
  perStage: Array<{
    provider: string;
    model: string;
    costCredits: number;
    /** True when no provider_models row was found for this (provider, model). */
    missing: boolean;
  }>;
  missingCount: number;
}

/**
 * Pull pricing for every (provider, modelKey) referenced by `stages`
 * in a single DB round-trip, then sum.
 */
export async function computeTemplateCost(
  db: Db,
  stages: ReadonlyArray<StageRef>,
): Promise<TemplateCostBreakdown> {
  if (stages.length === 0) {
    return { total: 0, perStage: [], missingCount: 0 };
  }

  // We can't do a (provider, model) tuple `IN` directly with Drizzle;
  // pull every row for the providers we touch, then map in JS. The
  // provider_models table is small (<100 rows in practice), so a
  // single scan is faster than N parameterised lookups.
  const providers = Array.from(new Set(stages.map((s) => s.provider)));
  const rows = await db
    .select({
      provider: providerModels.provider,
      modelKey: providerModels.modelKey,
      costCredits: providerModels.costCredits,
      tierPricing: providerModels.tierPricing,
    })
    .from(providerModels)
    .where(
      and(
        inArray(
          providerModels.provider,
          // Must list every enum member: this is a CAST, so a missing
          // provider compiles fine and then silently matches no rows —
          // the template would be costed at 0 credits.
          providers as ('gemini' | 'kling' | 'veo' | 'seedance' | 'openai')[],
        ),
      ),
    );

  const priceByKey = new Map<
    string,
    { base: number; tiers: Record<string, number> | null }
  >();
  for (const r of rows) {
    priceByKey.set(`${r.provider}/${r.modelKey}`, {
      base: r.costCredits,
      tiers: r.tierPricing ?? null,
    });
  }

  let total = 0;
  let missingCount = 0;
  const perStage = stages.map((s) => {
    const key = `${s.provider}/${s.model}`;
    const found = priceByKey.get(key);
    // Tier-aware: a stage configured for a specific quality costs that
    // tier's credits; otherwise the flat base. `mode` is canonical, but
    // legacy Seedance stages stored the tier under `resolution` — the
    // compiler honours both (compile.ts), so billing must too, or a
    // 1080p/4k stage generates at that tier while billing the base.
    const cfg = s.config ?? {};
    const tierKey =
      typeof cfg.mode === 'string'
        ? cfg.mode
        : typeof cfg.resolution === 'string'
          ? cfg.resolution
          : undefined;
    // Duration scales the charge, exactly as it does on the create flow.
    // Kling and Seedance bill per SECOND, and template costing used to
    // ignore that entirely: a 10s stage was billed at the 5s price, so
    // 31 of 101 published video stages were under-charged, most by 2x.
    // The reference length comes from the model registry rather than the
    // stage, because it is what the price was quoted at.
    const caps = findCapabilities(s.model);
    const refDuration = caps?.kind === 'video' ? caps.duration?.default : undefined;
    const cfgDuration = typeof cfg.duration === 'number' ? cfg.duration : undefined;
    // Audio-aware, with the compiler's own gating: on a tier below
    // `nativeAudioRequiresTier` the audio is dropped, not upgraded, so
    // the stage costs the silent price.
    const cfgSound = cfg.sound === true || cfg.sound === 'on';
    const soundServed =
      cfgSound &&
      caps?.supportsSound === true &&
      !(caps.nativeAudioRequiresTier && tierKey !== caps.nativeAudioRequiresTier);

    const cost = found
      ? resolveCreditCost({
          baseCredits: found.base,
          tierPricing: found.tiers,
          mode: tierKey,
          sound: soundServed,
          duration: cfgDuration ?? refDuration,
          defaultDuration: refDuration,
        })
      : 0;
    const missing = found === undefined;
    if (missing) missingCount += 1;
    total += cost;
    return { provider: s.provider, model: s.model, costCredits: cost, missing };
  });

  return { total, perStage, missingCount };
}

/**
 * Recompute every template's `cost_credits` after a model's price changed.
 *
 * Triggered from `PATCH /v1/admin/credits/models/:id`. Walks every
 * template whose generation.stages references the changed model and
 * re-sums against the now-current `provider_models.cost_credits`.
 *
 * Returns the number of templates touched so the API can log it for
 * the admin audit trail.
 */
export async function recomputeTemplatesForModel(
  db: Db,
  provider: string,
  modelKey: string,
): Promise<number> {
  // jsonb_path_exists pushes the "stages contain this model" filter
  // into Postgres so we don't ship every template back over the wire.
  // We then recompute the cost in JS and write it back row-by-row;
  // templates are small in number, this is cheap.
  const { sql } = await import('drizzle-orm');
  const affected = await db.execute<{
    id: string;
    generation: { stages: Array<{ provider: string; model: string }> };
  }>(sql`
    SELECT id, generation
    FROM templates
    WHERE jsonb_path_exists(
      generation,
      ('$.stages[*] ? (@.provider == "' || ${provider} || '" && @.model == "' || ${modelKey} || '")')::jsonpath
    )
  `);

  const rows = Array.isArray(affected)
    ? affected
    : ((affected as { rows?: unknown[] }).rows ?? []);

  if (rows.length === 0) return 0;

  let touched = 0;
  for (const row of rows as Array<{
    id: string;
    generation: { stages: Array<{ provider: string; model: string }> };
  }>) {
    const stages = row.generation?.stages ?? [];
    const breakdown = await computeTemplateCost(db, stages);
    const { sql: sqlTag } = await import('drizzle-orm');
    await db.execute(sqlTag`
      UPDATE templates
      SET cost_credits = ${breakdown.total}, updated_at = now()
      WHERE id = ${row.id}::uuid
    `);
    touched += 1;
  }
  return touched;
}
