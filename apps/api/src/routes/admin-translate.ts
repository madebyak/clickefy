/**
 * POST /v1/admin/translate — EN → AR machine translation for admin
 * content editing (DeepSeek behind `lib/translate-deepseek.ts`).
 *
 * Generic by design: the body is a flat `{ key: englishText }` map, so
 * one endpoint serves template titles, descriptions, per-input labels,
 * banner copy — the admin UI batches whatever fields it wants filled
 * and writes the results back into the normal PATCH payload. Nothing is
 * persisted here; the admin still reviews + saves.
 *
 * Auth: templates-page admins. Rate-limited like other admin writes.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

import type { AppEnv } from '../types';
import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import { translateToArabic } from '../lib/translate-deepseek';

export const adminTranslateRoute = new Hono<AppEnv>();

const TranslateSchema = z.object({
  texts: z
    .record(z.string().min(1).max(64), z.string().min(1).max(4000))
    .refine((r) => Object.keys(r).length >= 1 && Object.keys(r).length <= 60, {
      message: 'Between 1 and 60 texts per request.',
    }),
  context: z.string().max(500).optional(),
});

adminTranslateRoute.post(
  '/',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  withAdmin({ page: 'templates' }),
  zValidator('json', TranslateSchema),
  async (c) => {
    const apiKey = c.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return c.json(
        {
          error: {
            code: 'not_configured',
            message: 'DEEPSEEK_API_KEY is not set on the Worker.',
          },
        },
        503,
      );
    }

    const { texts, context } = c.req.valid('json');
    try {
      const translations = await translateToArabic({ apiKey, texts, context });
      return c.json({ data: { translations } });
    } catch (err) {
      console.error('[admin translate] DeepSeek failed:', err);
      return c.json(
        {
          error: {
            code: 'translation_failed',
            message: 'Translation service failed. Try again in a moment.',
          },
        },
        502,
      );
    }
  },
);
