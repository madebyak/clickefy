/**
 * `withDb` — attaches a per-request Drizzle client to `c.var.db`.
 *
 * Why per-request: Workers re-use the same isolate across requests, but
 * a `neon()` HTTP client is stateless and cheap to construct, so we
 * create one each time. This avoids leaking connection state across
 * unrelated requests and keeps cold-start cost negligible.
 *
 * Usage:
 *   app.use('*', withDb());
 *   app.get('/me', (c) => c.var.db.query.users.findFirst(...));
 */

import { createDb } from '@clickfy/db';
import { createMiddleware } from 'hono/factory';

import { loadDynamicModels } from '../lib/dynamic-models';
import type { AppEnv } from '../types';

export function withDb() {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!c.env.DATABASE_URL) {
      return c.json(
        {
          error: {
            code: 'db_unconfigured',
            message:
              'DATABASE_URL is not set. Drop the Neon connection string into apps/api/.dev.vars.',
          },
        },
        500,
      );
    }
    const db = createDb({ connectionString: c.env.DATABASE_URL, runtime: 'http' });
    c.set('db', db);
    // Database-driven fal models join the capability registry from here,
    // refreshed in the BACKGROUND once a minute per isolate. Never awaited
    // on this path: the upload proxy, the outputs proxy and every other
    // route must not wait on a registry query (2026-10-04: a blocking
    // await here coincided with upload reads from the worker hanging).
    // Routes that need the registry call `ensureDynamicModels` themselves.
    const load = loadDynamicModels(db).catch(() => undefined);
    try {
      c.executionCtx.waitUntil(load);
    } catch {
      // No execution context (tests) — the promise still runs.
    }
    await next();
  });
}
