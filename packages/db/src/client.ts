/**
 * Drizzle client factory.
 *
 * Single source of truth for "give me a typed `db` handle". Uses the
 * Neon serverless driver, which is dual-mode:
 *
 *   - On Cloudflare Workers, queries go over HTTPS via the `neon()`
 *     stateless client. No connection pooling, no socket lifecycle —
 *     ideal for V8 isolates.
 *
 *   - In Node (admin Next.js, drizzle-kit migrations, scripts) we use
 *     the `Pool` over WebSocket, with `ws` as the transport polyfill.
 *
 * Both expose the same Drizzle API. Consumers don't care which one's
 * underneath.
 */

import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleHttp, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleSocket, type NeonDatabase } from 'drizzle-orm/neon-serverless';

import * as schema from './schema';

export type Schema = typeof schema;

/**
 * `Db` is the public type consumers pass around. We intentionally make
 * it the intersection of both runtime variants so call-sites don't have
 * to pick — every Drizzle method we care about is on both.
 */
export type Db = NeonHttpDatabase<Schema> | NeonDatabase<Schema>;

/** Options for the factory. Pass the connection string explicitly; we
 * don't read `process.env` here because Workers don't have one. */
export interface CreateDbOptions {
  /** Postgres connection string (Neon's `?sslmode=require` form). */
  connectionString: string;
  /** Force a specific runtime. Default: auto-detect (Workers → http, Node → socket). */
  runtime?: 'http' | 'socket';
}

/** Detect Workers vs Node without throwing. */
function detectRuntime(): 'http' | 'socket' {
  // Workers expose a global `WebSocketPair`; Node does not.
  if (typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== 'undefined') {
    return 'http';
  }
  return 'socket';
}

/**
 * Create a Drizzle client. Idempotent at the call-site — callers are
 * expected to memoize one client per request in Workers, or one per
 * process in Node.
 */
export function createDb({ connectionString, runtime }: CreateDbOptions): Db {
  const mode = runtime ?? detectRuntime();

  if (mode === 'http') {
    const sql = neon(connectionString);
    return drizzleHttp(sql, { schema });
  }

  // Lazy-require `ws` only in Node, so Workers bundlers don't try to
  // include it. Node `Pool` needs a WebSocket implementation; the
  // browser's built-in one is used in browser-ish runtimes (Edge).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws') as { WebSocket: typeof WebSocket };
  neonConfig.webSocketConstructor = ws.WebSocket;
  const pool = new Pool({ connectionString });
  return drizzleSocket(pool, { schema });
}

/** Re-export the schema so consumers can `import { db, schema } from '@clickfy/db'`. */
export { schema };
