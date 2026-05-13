import type { Db } from '@clickfy/db';
import type { users } from '@clickfy/db';

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}

export interface Bindings {
  ENVIRONMENT: 'development' | 'production';
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';

  // ─── Clerk ─────────────────────────────────────────────────────
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  /** PEM-encoded RSA public key used to verify session JWTs offline. */
  CLERK_JWT_KEY?: string;
  /** Svix signing secret for the Clerk webhook endpoint (whsec_...). */
  CLERK_WEBHOOK_SECRET?: string;

  // ─── Data plane ───────────────────────────────────────────────
  /** Neon Postgres connection string (sslmode=require). */
  DATABASE_URL: string;

  // ─── Payments ─────────────────────────────────────────────────
  REVENUECAT_WEBHOOK_SECRET?: string;

  // ─── Job orchestration (Trigger.dev) ──────────────────────────
  /**
   * API key used to fire generation runs against the Trigger.dev
   * cloud. Lives in `apps/api/.dev.vars` for local dev and as a
   * Worker secret in production. The matching task identifier is
   * `generate-job` (see `apps/jobs-worker/src/trigger/`).
   */
  TRIGGER_SECRET_KEY?: string;
  /** Project ref shown in the Trigger.dev dashboard, e.g. `proj_xxx`. */
  TRIGGER_PROJECT_REF?: string;

  /**
   * Shared secret used by the Trigger.dev jobs worker to write
   * generated outputs back through the Worker (avoids duplicating R2
   * S3 credentials across services — see `routes/outputs.ts`).
   * Generate with `openssl rand -hex 32` and store as a Worker secret
   * in production.
   */
  INTERNAL_API_SECRET?: string;

  // ─── Cloudflare bindings (filled when we deploy) ──────────────
  /** User-provided assets: admin uploads + mobile user inputs. */
  UPLOADS?: R2Bucket;
  /** AI-generated outputs persisted by Trigger.dev tasks. */
  OUTPUTS?: R2Bucket;
  RATE_LIMIT?: KVNamespace;
}

/** Row shape from the `users` table — `users.$inferSelect`. */
export type CurrentUser = typeof users.$inferSelect;

export interface Variables {
  requestId: string;
  /** Drizzle client, attached per-request by `withDb` middleware. */
  db: Db;
  /** Clerk user id (`user_xxx`) — set by `withAuth` when a valid token is present. */
  clerkUserId?: string;
  /** Neon `users` row — set by `withCurrentUser` after we resolve/upsert. */
  user?: CurrentUser;
}
