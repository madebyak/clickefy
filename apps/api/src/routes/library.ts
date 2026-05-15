/**
 * /v1/library — user-scoped reads that aren't a job or a template
 * directly: saved templates (favorites), recent-templates derived
 * from job history, etc.
 *
 * Why a separate route module:
 *   - The catalog endpoints are public (signed-out home screen);
 *     library is auth-only. Splitting them keeps the cache headers
 *     and middleware obvious per file.
 *   - The mobile SDK's `library` namespace maps 1:1 to this path,
 *     so the route file mirrors the consumer's mental model.
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';

import { savedTemplates, templates, users } from '@clickfy/db';

import type { AppEnv } from '../types';
import { templateToMobileDTO } from '../lib/template-dto';
import { loadTemplateCategoriesMap } from '../lib/template-categories';
import { withAuth } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';

export const libraryRoute = new Hono<AppEnv>();

// ─── GET /v1/library/saved ──────────────────────────────────────────
//
// Returns the templates the current user has saved (newest first).
// We embed the full mobile template DTO so the screen renders
// without a second fetch per row.
//
// Pagination: limit clamped 1..50 (default 30). Cursor is the
// `created_at` of the last item; if a user has many thousand saves
// we'll grow this into proper keyset pagination, but at typical
// usage the first 30 cover the visible window.

libraryRoute.get(
  '/saved',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  async (c) => {
    const clerkUserId = c.var.clerkUserId!;
    const userRow = await c.var.db.query.users.findFirst({
      where: eq(users.clerkUserId, clerkUserId),
      columns: { id: true },
    });
    if (!userRow) {
      return c.json(
        { error: { code: 'user_not_provisioned', message: 'Account not provisioned.' } },
        401,
      );
    }

    const limitRaw = Number(c.req.query('limit') ?? '30');
    const limit = Number.isFinite(limitRaw)
      ? Math.min(50, Math.max(1, Math.floor(limitRaw)))
      : 30;

    // Drizzle's relational query loads the joined template alongside
    // each row. We only need columns the mobile DTO consumes; the
    // generation/output jsonb columns (admin-only) stay on the server.
    const rows = await c.var.db.query.savedTemplates.findMany({
      where: eq(savedTemplates.userId, userRow.id),
      orderBy: [desc(savedTemplates.createdAt)],
      limit,
      with: {
        template: true,
      },
    });

    const publicBaseUrl = new URL(c.req.url).origin;
    const visible = rows
      // Hide saved entries whose template was archived. We could
      // surface them as "unavailable" but it would just confuse —
      // a save list should always be tappable.
      .filter((r) => r.template && r.template.status === 'published');
    const catsMap = await loadTemplateCategoriesMap(
      c.var.db,
      visible.map((r) => r.template!.id),
    );
    const items = visible.map((r) => ({
      ...templateToMobileDTO(r.template!, {
        publicBaseUrl,
        categoryIds: catsMap.get(r.template!.id)?.all ?? [],
      }),
      isFavorited: true,
      savedAt: r.createdAt.toISOString(),
    }));

    c.header('Cache-Control', 'private, max-age=5');
    return c.json({ data: { items } });
  },
);
