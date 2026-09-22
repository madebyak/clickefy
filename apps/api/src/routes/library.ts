/**
 * `/v1/library` — the signed-in user's personal template library.
 *
 * GET /v1/library/saved — the user's saved (favorited) templates,
 * newest-save first.
 *
 * This endpoint has been in the shipped mobile SDK since day one
 * (`library.listSavedTemplates` → the Saved screen behind the bookmark
 * icon in the Library tab) but was never mounted on the API, so every
 * open of that screen 404'd. It is implemented AT the path the shipped
 * clients already call — changing the client instead would have left
 * every installed build broken forever.
 *
 * Response shape is fixed by the SDK contract: `{ data: { items } }`
 * where each item is a full MobileTemplate DTO with `isFavorited: true`
 * baked in (the caller is looking at their own saves, so the flag is
 * true by definition — no second lookup).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { savedTemplates, templates } from '@clickfy/db';
import type { UserLocale } from '@clickfy/types';

import type { AppEnv } from '../types';
import { templateToMobileDTO } from '../lib/template-dto';
import { loadTemplateCategoriesMap } from '../lib/template-categories';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';

export const libraryRoute = new Hono<AppEnv>();

const savedQuerySchema = z.object({
  /** Page size. The Saved screen asks for 50; clamp defensively. */
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Target locale for user-facing copy, same contract as the catalog. */
  locale: z.enum(['en', 'ar']).optional(),
});

libraryRoute.get(
  '/saved',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  withCurrentUser(),
  zValidator('query', savedQuerySchema),
  async (c) => {
    const q = c.req.valid('query');
    const userRow = c.var.user!;

    // Join through the bookmark table so ordering is save-recency (the
    // `(user_id, created_at desc)` index exists for exactly this scan).
    // Unpublished/archived templates drop out of the list rather than
    // render as dead cards — the save row itself is kept, so a template
    // that is re-published reappears.
    const rows = await c.var.db
      .select({ row: templates })
      .from(savedTemplates)
      .innerJoin(templates, eq(templates.id, savedTemplates.templateId))
      .where(
        and(
          eq(savedTemplates.userId, userRow.id),
          eq(templates.status, 'published'),
        ),
      )
      .orderBy(desc(savedTemplates.createdAt))
      .limit(q.limit);

    const page = rows.map((r) => r.row);
    const publicBaseUrl = new URL(c.req.url).origin;
    const locale: UserLocale = q.locale === 'ar' ? 'ar' : 'en';
    const catsMap = await loadTemplateCategoriesMap(
      c.var.db,
      page.map((r) => r.id),
    );

    const items = page.map((row) => ({
      ...templateToMobileDTO(row, {
        publicBaseUrl,
        categoryIds: catsMap.get(row.id)?.all ?? [],
        locale,
      }),
      isFavorited: true,
    }));

    return c.json({ data: { items } });
  },
);
