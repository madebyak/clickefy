/**
 * `recoverStuckJobs` — scheduled sweeper that rescues jobs which
 * never made it out of the `queued` state.
 *
 * Why this exists: the Worker's POST /v1/jobs handler dispatches a
 * Trigger.dev run *after* the row is committed. If Trigger.dev is
 * down, mid-deploy, or the dispatch HTTP call fails for any reason,
 * the job sits in `queued` forever — credits debited, user staring
 * at a spinner on the `generating` screen.
 *
 * Strategy: every 60 seconds, find rows that have been `queued`
 * longer than 30 seconds. Re-trigger them (idempotent — the task's
 * own `already_terminal` guard plus our refund-dedup CTE prevent
 * double-execution). After 5 failed sweeps for the same job,
 * declare it `failed` with `internal_error` so the user gets their
 * credits back and isn't stuck forever.
 *
 * Cron: every minute. The window is small (30s grace) so users
 * recover quickly; the cost is one cheap SELECT per minute even on
 * an idle system.
 *
 * Atomicity: we re-fire `generateJob.trigger()` without changing
 * the row's status. If the original dispatch did go through and
 * the run is in flight, the recovery trigger is harmless — the
 * `already_terminal` / `processing` guards in generate-job.ts
 * make it a no-op.
 */

import { logger, schedules } from '@trigger.dev/sdk';
import { and, eq, sql } from 'drizzle-orm';

import { jobs } from '@clickfy/db';

import { getDb } from '../lib/db';
import { generateJob } from './generate-job';

/** Max recovery attempts before we mark the job failed and refund. */
const MAX_RECOVERY_ATTEMPTS = 5;
/** Only consider jobs older than this when sweeping. Keeps the
 *  sweeper out of the way of normal dispatch latency. */
const STUCK_AFTER_SECONDS = 30;

export const recoverStuckJobs = schedules.task({
  id: 'recover-stuck-jobs',
  cron: '* * * * *', // every minute
  maxDuration: 60,

  run: async () => {
    const db = getDb();

    // Find all `queued` rows older than the grace window. The
    // `created_at < now() - interval` predicate is index-friendly
    // (jobs table is indexed on `created_at DESC`) and `status` is
    // selective enough that the planner picks it without a hint.
    const stuck = await db.execute<{
      id: string;
      created_at: Date;
      recovery_attempts: number;
    }>(sql`
      SELECT
        id,
        created_at,
        COALESCE((error->>'retryCount')::int, 0) AS recovery_attempts
      FROM jobs
      WHERE status = 'queued'
        AND created_at < now() - (${STUCK_AFTER_SECONDS} || ' seconds')::interval
      ORDER BY created_at ASC
      LIMIT 50
    `);
    const rows = (Array.isArray(stuck) ? stuck : (stuck as { rows?: unknown[] }).rows ?? []) as Array<{
      id: string;
      created_at: Date;
      recovery_attempts: number;
    }>;

    if (rows.length === 0) return { recovered: 0, abandoned: 0 };

    logger.info('recover-stuck-jobs:found', { count: rows.length });

    let recovered = 0;
    let abandoned = 0;

    for (const row of rows) {
      // Give up after MAX attempts — mark failed, refund, and move on.
      // We bake the attempts counter into `error.retryCount` so it
      // survives across sweeper invocations without a new column.
      if (row.recovery_attempts >= MAX_RECOVERY_ATTEMPTS) {
        await abandonJob(row.id, row.recovery_attempts);
        abandoned += 1;
        continue;
      }

      // Bump the attempt counter first — even if the trigger call
      // throws, the next sweep sees a higher count and won't loop
      // forever on a permanently broken row.
      await db
        .update(jobs)
        .set({
          error: {
            code: 'recovery_pending',
            message: `Recovery attempt ${row.recovery_attempts + 1}`,
            stage: 0,
            retryCount: row.recovery_attempts + 1,
          },
        })
        .where(and(eq(jobs.id, row.id), eq(jobs.status, 'queued')));

      try {
        await generateJob.trigger({ jobId: row.id });
        recovered += 1;
        logger.info('recover-stuck-jobs:retriggered', {
          jobId: row.id,
          attempt: row.recovery_attempts + 1,
        });
      } catch (err) {
        logger.error('recover-stuck-jobs:trigger-failed', {
          jobId: row.id,
          err: String(err),
        });
        // Don't throw — keep sweeping the rest. Next minute we try again.
      }
    }

    return { recovered, abandoned };
  },
});

/**
 * Mark a job permanently failed after MAX_RECOVERY_ATTEMPTS and
 * issue a refund. We import the refund helper lazily here to avoid
 * a circular module graph (refund.ts → db.ts; this file → refund.ts).
 */
async function abandonJob(jobId: string, attempts: number): Promise<void> {
  const { refundForJob } = await import('../lib/refund');
  const db = getDb();

  await db
    .update(jobs)
    .set({
      status: 'failed',
      error: {
        code: 'internal_error',
        message: `Job could not be dispatched after ${attempts} attempts.`,
        stage: 0,
        retryCount: attempts,
      },
      completedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued')));

  try {
    await refundForJob(jobId);
  } catch (err) {
    logger.error('recover-stuck-jobs:abandon-refund-failed', {
      jobId,
      err: String(err),
    });
  }

  logger.warn('recover-stuck-jobs:abandoned', { jobId, attempts });
}
