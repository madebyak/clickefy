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
    await next();
  });
}
