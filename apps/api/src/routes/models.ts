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
import { withAuth } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import { buildCreateModelDTO, CREATE_MODEL_DEFS } from '../lib/create-models';

export const modelsRoute = new Hono<AppEnv>();

modelsRoute.get(
  '/',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  async (c) => {
    const rosterKeys = CREATE_MODEL_DEFS.map((d) => d.modelKey);

    const rows = await c.var.db
      .select({
        modelKey: providerModels.modelKey,
        costCredits: providerModels.costCredits,
        status: providerModels.status,
      })
      .from(providerModels)
      .where(inArray(providerModels.modelKey, rosterKeys));

    const priceByKey = new Map(rows.map((r) => [r.modelKey, r]));

    // Preserve roster (display) order; drop unpriced / deprecated.
    const models = CREATE_MODEL_DEFS.flatMap((def) => {
      const row = priceByKey.get(def.modelKey);
      if (!row || row.status === 'deprecated' || row.costCredits <= 0) return [];
      const dto = buildCreateModelDTO(def.modelKey, row.costCredits);
      return dto ? [dto] : [];
    });

    // Small edge cache — the roster + prices change rarely.
    c.header('Cache-Control', 'private, max-age=60');
    return c.json({ data: { models } });
  },
);
