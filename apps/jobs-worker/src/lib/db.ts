/**
 * Per-task Drizzle client.
 *
 * The Trigger.dev runtime is Node — we use the socket-backed Neon
 * driver here (long-lived pool over WebSocket). That contrasts with
 * the Worker's `runtime: 'http'` choice, which is required by
 * Cloudflare's V8 isolates. The `createDb()` factory in
 * `@clickfy/db` abstracts the difference so this module stays a
 * single line of "give me a typed db".
 *
 * One client per task invocation is fine; Trigger.dev workers are
 * long-lived processes that can amortise pool warm-up across many
 * runs.
 */

import { createDb, type Db } from '@clickfy/db';

import { env } from '../env';

let cached: Db | null = null;

export function getDb(): Db {
  if (!cached) {
    cached = createDb({ connectionString: env.DATABASE_URL, runtime: 'socket' });
  }
  return cached;
}
