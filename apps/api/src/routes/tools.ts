/**
 * `/v1/tools/*` — what the studio tools need before a job exists.
 *
 *   GET /ad   the One-Click Ad's price and limits, computed the same way
 *             the create route will charge: Seedance 2.5 at the ad tier
 *             for the ad length with audio, plus the writing step.
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';

import { providerModels } from '@clickfy/db';
import {
  AD_DURATION_SECONDS,
  AD_MAX_IMAGES,
  AD_MAX_NOTE_CHARS,
  AD_SCRIPT_CREDITS,
  TOOL_MODELS,
  findCapabilities,
} from '@clickfy/providers';
import { resolveCreditCost } from '@clickfy/types';

import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const toolsRoute = new Hono<AppEnv>();

toolsRoute.get(
  '/ad',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  async (c) => {
    const { modelKey, quality } = TOOL_MODELS.ad;
    const caps = findCapabilities(modelKey);
    const row = await c.var.db.query.providerModels.findFirst({
      where: and(eq(providerModels.modelKey, modelKey), eq(providerModels.status, 'active')),
      columns: { costCredits: true, tierPricing: true },
    }) ?? await c.var.db.query.providerModels.findFirst({
      where: eq(providerModels.modelKey, modelKey),
      columns: { costCredits: true, tierPricing: true },
    });
    if (!row || !caps) {
      return c.json({ error: { code: 'model_unpriced', message: 'The ad model is not available right now.' } }, 503);
    }
    const video = resolveCreditCost({
      baseCredits: row.costCredits,
      tierPricing: row.tierPricing ?? null,
      mode: quality,
      sound: caps.supportsSound === true,
      duration: AD_DURATION_SECONDS,
      defaultDuration: caps.duration?.default,
    });
    c.header('Cache-Control', 'private, max-age=60');
    return c.json({
      data: {
        credits: video + AD_SCRIPT_CREDITS,
        tier: quality,
        durationSeconds: AD_DURATION_SECONDS,
        maxImages: AD_MAX_IMAGES,
        maxNoteChars: AD_MAX_NOTE_CHARS,
      },
    });
  },
);
