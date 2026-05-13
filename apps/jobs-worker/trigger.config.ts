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

import { defineConfig } from '@trigger.dev/sdk';

export default defineConfig({
  project: 'proj_dqwnwsfyhccgrtzxoqbt',

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
