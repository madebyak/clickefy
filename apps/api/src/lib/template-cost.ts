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

interface StageRef {
  provider: 'gemini' | 'kling' | 'veo' | string;
  model: string;
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
    })
    .from(providerModels)
    .where(
      and(
        inArray(providerModels.provider, providers as ('gemini' | 'kling' | 'veo')[]),
      ),
    );

  const priceByKey = new Map<string, number>();
  for (const r of rows) {
    priceByKey.set(`${r.provider}/${r.modelKey}`, r.costCredits);
  }

  let total = 0;
  let missingCount = 0;
  const perStage = stages.map((s) => {
    const key = `${s.provider}/${s.model}`;
    const found = priceByKey.get(key);
    const cost = found ?? 0;
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
