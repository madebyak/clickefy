/**
 * GET /v1/models — create-flow model catalog for the mobile app.
 *
 * Returns the curated, create-eligible model roster with everything the
 * "create from scratch" screen needs to render its model-adaptive UI:
 * commercial name, modality, credit cost, prompt cap, aspect ratios,
 * durations, image budget, and attachment shape.
 *
 * Data is merged from three sources:
 *   - the roster + attachment UI shape (`lib/create-models.ts`),
 *   - the code capability registry (`@clickfy/providers`),
 *   - the DB price (`provider_models.cost_credits`).
 *
 * Models that are unpriced (`cost_credits <= 0`) or `deprecated` are
 * filtered out so the picker never shows something un-purchasable.
 *
 * Auth: required (the picker is behind the app's authed shell) but no
 * role check — it's the same catalog for every signed-in user.
 */

import { Hono } from 'hono';
import { inArray } from 'drizzle-orm';

import { providerModels } from '@clickfy/db';

import type { AppEnv } from '../types';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import { findCapabilities } from '@clickfy/providers';

import { buildCreateModelDTO, listCreateModelDefs } from '../lib/create-models';
import { ensureDynamicModels } from '../lib/dynamic-models';

export const modelsRoute = new Hono<AppEnv>();

modelsRoute.get(
  '/',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  // No user data is returned here, but a deleted account must not keep
  // using ANY authenticated surface — one indexed lookup buys a uniform,
  // auditable rule instead of a per-route judgement call.
  withCurrentUser(),
  async (c) => {
    await ensureDynamicModels(c.var.db);
    // Audio models have their own page on the web and no surface in the
    // app, so they are served only when asked for (`?kind=audio`), never
    // in the default roster a picker reads.
    const kindParam = c.req.query('kind');
    const defs = listCreateModelDefs().filter((d) => {
      const kind = findCapabilities(d.modelKey)?.kind ?? 'image';
      if (kindParam === 'all') return true;
      if (kindParam) return kind === kindParam;
      return kind !== 'audio';
    });
    const rosterKeys = defs.map((d) => d.modelKey);

    const rows = await c.var.db
      .select({
        modelKey: providerModels.modelKey,
        costCredits: providerModels.costCredits,
        tierPricing: providerModels.tierPricing,
        status: providerModels.status,
      })
      .from(providerModels)
      .where(inArray(providerModels.modelKey, rosterKeys));

    const priceByKey = new Map(rows.map((r) => [r.modelKey, r]));

    // Preserve roster (display) order; drop unpriced / deprecated.
    const models = defs.flatMap((def) => {
      const row = priceByKey.get(def.modelKey);
      if (!row || row.status === 'deprecated' || row.costCredits <= 0) return [];
      const dto = buildCreateModelDTO(def.modelKey, row.costCredits, row.tierPricing);
      return dto ? [dto] : [];
    });

    // Small edge cache — the roster + prices change rarely.
    c.header('Cache-Control', 'private, max-age=60');
    return c.json({ data: { models } });
  },
);
