/**
 * `/v1/admin/prompts/*` — the hidden prompts, editable without a deploy.
 *
 *   GET  /                 the keys and their titles
 *   GET  /:key             current text (saved or default), the default,
 *                          placeholders, limits, and the version history
 *   PUT  /:key             save `{ body, note? }` (becomes a version)
 *   POST /:key/reset       back to the code default
 *   POST /:key/preview     `{ imageCount, notes? }` → the brief exactly as
 *                          the model would receive it, from `body` if given
 *                          (unsaved edits) else the current text
 *
 * Behind `withAdmin({ page: 'settings' })`; the audit middleware records
 * the mutations.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { buildAdBrief } from '@clickfy/providers';

import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import {
  PROMPT_DEFS,
  PROMPT_KEYS,
  getPromptOverride,
  listPromptVersions,
  resetPrompt,
  savePrompt,
  type PromptKey,
} from '../lib/prompt-templates';
import type { AppEnv } from '../types';

export const adminPromptsRoute = new Hono<AppEnv>();

adminPromptsRoute.use(
  '*',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'settings' }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
);

const keyParam = z.object({ key: z.enum(PROMPT_KEYS) });

adminPromptsRoute.get('/', (c) =>
  c.json({ data: PROMPT_KEYS.map((key) => ({ key, title: PROMPT_DEFS[key].title, description: PROMPT_DEFS[key].description })) }),
);

adminPromptsRoute.get('/:key', zValidator('param', keyParam), async (c) => {
  const { key } = c.req.valid('param');
  const def = PROMPT_DEFS[key];
  const [override, versions] = await Promise.all([getPromptOverride(c.var.db, key), listPromptVersions(c.var.db, key)]);
  return c.json({
    data: {
      key,
      title: def.title,
      description: def.description,
      body: override ?? def.default,
      isDefault: override == null,
      default: def.default,
      maxChars: def.maxChars,
      placeholders: def.placeholders,
      versions: versions.map((v) => ({ id: v.id, body: v.body, note: v.note, createdAt: v.createdAt.toISOString() })),
    },
  });
});

adminPromptsRoute.put(
  '/:key',
  zValidator('param', keyParam),
  zValidator('json', z.object({ body: z.string().min(50), note: z.string().trim().max(200).optional().nullable() })),
  async (c) => {
    const { key } = c.req.valid('param');
    const { body, note } = c.req.valid('json');
    const def = PROMPT_DEFS[key];
    if (body.length > def.maxChars) {
      return c.json({ error: { code: 'too_long', message: `At most ${def.maxChars} characters.`, details: { max: def.maxChars, actual: body.length } } }, 422);
    }
    await savePrompt(c.var.db, key, body, c.var.user?.id ?? null, note ?? null);
    return c.json({ data: { key, saved: true } });
  },
);

adminPromptsRoute.post('/:key/reset', zValidator('param', keyParam), async (c) => {
  const { key } = c.req.valid('param');
  await resetPrompt(c.var.db, key, c.var.user?.id ?? null);
  return c.json({ data: { key, reset: true } });
});

adminPromptsRoute.post(
  '/:key/preview',
  zValidator('param', keyParam),
  zValidator('json', z.object({ body: z.string().optional(), imageCount: z.number().int().min(1).max(5).default(1), notes: z.string().max(1000).optional() })),
  async (c) => {
    const { key } = c.req.valid('param');
    const { body, imageCount, notes } = c.req.valid('json');
    const template = body ?? (await getPromptOverride(c.var.db, key as PromptKey)) ?? PROMPT_DEFS[key].default;
    const rendered = buildAdBrief({ imageCount, notes, template });
    return c.json({ data: { rendered, chars: rendered.length } });
  },
);
