/**
 * Trigger.dev v4 project configuration.
 *
 * This file is consumed by the `trigger.dev` CLI (both `dev` and
 * `deploy`). The CLI matches files under `dirs` for task definitions
 * and bundles them into a Trigger.dev project identified by `project`.
 *
 * Project ref comes from the dashboard
 * (https://cloud.trigger.dev → project → settings → API keys). It MUST
 * match `TRIGGER_PROJECT_REF` in the Worker's env so triggered runs
 * land in this project.
 */

import * as Sentry from '@sentry/node';
import { defineConfig } from '@trigger.dev/sdk';

export default defineConfig({
  project: 'proj_dqwnwsfyhccgrtzxoqbt',

  /**
   * Boot hook: initialise Sentry once per worker process before any
   * task runs. Trigger.dev v4 calls `init` exactly once when the
   * container starts, so this is the right place to set up SDKs that
   * need long-lived state (HTTP transports, OTel exporters, etc.).
   *
   * `SENTRY_DSN` must be set in the project's prod environment
   * (Trigger dashboard → Environment variables). Without it the call
   * becomes a no-op rather than throwing, so local dev keeps working.
   */
  init: async () => {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'production',
      // Sample everything in jobs — failure volume is low and each
      // run is a discrete unit of work we want full traces for.
      tracesSampleRate: 1.0,
    });
  },

  /**
   * Lifecycle hook that fires only after Trigger.dev exhausts the
   * configured retry budget. By forwarding to Sentry here we avoid
   * spamming the project with transient failures the retry policy
   * would have recovered automatically.
   */
  onFailure: async ({ payload, error, ctx }) => {
    Sentry.captureException(error, {
      tags: {
        taskId: ctx.task.id,
        runId: ctx.run.id,
        env: ctx.environment.type,
      },
      extra: {
        // Payloads are small JSON blobs (jobId, etc.), safe to attach.
        payload,
      },
    });
    // Best-effort flush so the event lands before the process is torn
    // down at the end of the run. 2s is plenty for the HTTP transport.
    await Sentry.flush(2_000).catch(() => undefined);
  },

  // Directories the CLI scans for `task()` definitions.
  // Keep flat — one folder for the generation pipeline, room to grow.
  dirs: ['./src/trigger'],

  // Default per-run retry policy. Individual tasks can override via
  // their own `retry` block. We start conservative: a couple of fast
  // retries for transient 5xx/network blips, no further attempts so
  // unrecoverable failures surface promptly in the UI rather than
  // soaking for minutes.
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },

  // Maximum runtime per task. Image generation takes ~10s, video can
  // reach 90s for Kling — pad generously so we don't kill a job that
  // is just slow upstream. The compensation cron (B3.refunds, future)
  // is the safety net for runs that actually hang forever.
  maxDuration: 600,
});
