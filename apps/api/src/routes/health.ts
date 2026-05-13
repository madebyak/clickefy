import { sql } from '@clickfy/db';
import { Hono } from 'hono';

import type { AppEnv } from '../types';

export const health = new Hono<AppEnv>();

health.get('/', (c) =>
  c.json({
    status: 'ok',
    environment: c.env.ENVIRONMENT,
    region: c.req.raw.cf?.colo ?? 'unknown',
    timestamp: new Date().toISOString(),
  }),
);

/**
 * Round-trips a `SELECT 1` against the database. Used to verify the
 * Neon connection string is wired correctly before any real endpoint
 * goes live. Should return < 100ms when both Workers and Neon sit in
 * the same region.
 */
health.get('/db', async (c) => {
  const started = Date.now();
  try {
    const result = (await c.var.db.execute(sql`select 1 as ok`)) as unknown as
      | Array<{ ok: number }>
      | { rows: Array<{ ok: number }> };
    const rows = Array.isArray(result) ? result : result.rows;
    return c.json({
      status: 'ok',
      latencyMs: Date.now() - started,
      result: rows[0]?.ok ?? null,
    });
  } catch (err) {
    return c.json(
      {
        status: 'error',
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : 'unknown',
      },
      503,
    );
  }
});
