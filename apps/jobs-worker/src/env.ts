/**
 * Env-var validation for the Trigger.dev jobs worker.
 *
 * Trigger.dev injects vars set in the dashboard's "Environment
 * variables" tab into `process.env` at task run time. Local `dev`
 * runs read from `.env` files in this directory. Parsing once at
 * module load gives the entire codebase one typed source of truth,
 * and we crash early if a required var is missing rather than
 * deferring to a confusing `undefined` partway through a job.
 */

import { z } from 'zod';

const envSchema = z.object({
  // ── Database ─────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1),

  // ── Worker API endpoint ──────────────────────────────────────
  // The orchestrator does ALL R2 access via the Worker — reads
  // through GET /v1/uploads/<key> and writes through PUT
  // /v1/outputs/internal/<key>. No direct S3 from this process.
  // See apps/jobs-worker/src/lib/r2.ts for the rationale.
  WORKER_API_URL: z.string().url(),
  INTERNAL_API_SECRET: z.string().min(1),

  // ── Provider credentials ─────────────────────────────────────
  GEMINI_API_KEY: z.string().min(1).optional(),
  KLING_ACCESS_KEY: z.string().min(1).optional(),
  KLING_SECRET_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = (() => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `[jobs-worker] Missing or invalid environment variables:\n${issues}\n\n` +
        `Set these in the Trigger.dev dashboard (Environments → Production) ` +
        `or in apps/jobs-worker/.env for local dev.`,
    );
  }
  return parsed.data;
})();
