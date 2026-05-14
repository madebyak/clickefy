/**
 * `recoverStuckJobs` — scheduled sweeper that rescues jobs which
 * never made it to a terminal state. Two distinct failure modes:
 *
 *   A) Stuck in `queued` — the POST /v1/jobs handler debited credits
 *      and inserted the row, but the follow-up `generateJob.trigger()`
 *      call to Trigger.dev failed (network blip, mid-deploy, etc.).
 *      Recovery: re-trigger up to MAX_RECOVERY_ATTEMPTS times.
 *
 *   B) Stuck in `processing` — Trigger.dev picked up the job, the
 *      worker marked it `processing`, then the run hard-crashed
 *      (provider hung past maxDuration, isolate OOM, etc.) without
 *      writing back a terminal status. Recovery: declare it failed
 *      and refund. No re-trigger because the AI call may have already
 *      consumed provider quota — silently retrying could double-bill.
 *
 * Cron: every 60s. Cheap (two indexed SELECTs per minute) and gives
 * users a quick path out of a stuck UI.
 *
 * Atomicity for (A): we re-fire `generateJob.trigger()` without
 * changing the row's status. If the original dispatch did go through
 * and the run is in flight, the recovery trigger is harmless — the
 * `already_terminal` / `processing` guards in generate-job.ts make
 * it a no-op. The attempt counter is bumped FIRST so even if the
 * trigger throws, the next sweep sees the higher count.
 *
 * Atomicity for (B): the abandon UPDATE is gated on
 * `status = 'processing'`. If the worker happens to complete
 * mid-sweep and writes `completed`, our UPDATE matches zero rows
 * and we leave the row alone — no double-finalize.
 */

import { logger, schedules } from '@trigger.dev/sdk';
import { and, eq, sql } from 'drizzle-orm';

import { jobs } from '@clickfy/db';

import { getDb } from '../lib/db';
import { generateJob } from './generate-job';

/** Max recovery attempts before we mark the job failed and refund. */
const MAX_RECOVERY_ATTEMPTS = 5;
/** Only consider `queued` jobs older than this when sweeping. Keeps
 *  the sweeper out of the way of normal dispatch latency. */
const QUEUED_STUCK_AFTER_SECONDS = 30;
/** Cap on legitimate `processing` runtime. Our longest provider call
 *  (Kling video) finishes well under 5 minutes; 10 min is a generous
 *  ceiling beyond which the run is almost certainly a crashed worker
 *  rather than slow-but-alive. Bump if a new provider takes longer. */
const PROCESSING_STUCK_AFTER_SECONDS = 600;

export const recoverStuckJobs = schedules.task({
  id: 'recover-stuck-jobs',
  cron: '* * * * *', // every minute
  maxDuration: 60,

  run: async () => {
    const db = getDb();

    // ── Pass A: jobs stuck in `queued` ──────────────────────────────
    // Dispatch to Trigger.dev failed; the run never started. We can
    // safely re-trigger because no provider call has happened yet.
    const stuckQueued = await db.execute<{
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
        AND created_at < now() - (${QUEUED_STUCK_AFTER_SECONDS} || ' seconds')::interval
      ORDER BY created_at ASC
      LIMIT 50
    `);
    const queuedRows = (Array.isArray(stuckQueued)
      ? stuckQueued
      : (stuckQueued as { rows?: unknown[] }).rows ?? []) as Array<{
      id: string;
      created_at: Date;
      recovery_attempts: number;
    }>;

    // ── Pass B: jobs stuck in `processing` ──────────────────────────
    // Worker crashed mid-run. We do NOT re-trigger (provider quota may
    // already be spent); we mark failed and refund.
    const stuckProcessing = await db.execute<{ id: string }>(sql`
      SELECT id
      FROM jobs
      WHERE status = 'processing'
        AND started_at IS NOT NULL
        AND started_at < now() - (${PROCESSING_STUCK_AFTER_SECONDS} || ' seconds')::interval
      ORDER BY started_at ASC
      LIMIT 50
    `);
    const processingRows = (Array.isArray(stuckProcessing)
      ? stuckProcessing
      : (stuckProcessing as { rows?: unknown[] }).rows ?? []) as Array<{ id: string }>;

    if (queuedRows.length === 0 && processingRows.length === 0) {
      return { recovered: 0, abandoned: 0 };
    }

    logger.info('recover-stuck-jobs:found', {
      queued: queuedRows.length,
      processing: processingRows.length,
    });

    let recovered = 0;
    let abandoned = 0;

    // ── Handle queued ────────────────────────────────────────────────
    for (const row of queuedRows) {
      if (row.recovery_attempts >= MAX_RECOVERY_ATTEMPTS) {
        await abandonJob(row.id, 'queued', row.recovery_attempts);
        abandoned += 1;
        continue;
      }

      // Bump attempt counter first so a permanently-broken row can't
      // loop the sweeper forever.
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

    // ── Handle processing-too-long ──────────────────────────────────
    // No retry attempt; provider may have already charged us. Mark
    // failed + refund. The UPDATE's `status = 'processing'` predicate
    // means if the worker finishes between our SELECT and UPDATE we
    // leave the row alone — no double-finalize.
    for (const row of processingRows) {
      await abandonJob(row.id, 'processing', 0);
      abandoned += 1;
      logger.warn('recover-stuck-jobs:processing-timeout', { jobId: row.id });
    }

    return { recovered, abandoned };
  },
});

/**
 * Mark a job permanently failed and issue a refund.
 *
 * `fromStatus` gates the UPDATE so we never overwrite a row that
 * raced into a terminal state between our SELECT and our UPDATE.
 * For `queued` abandonments the message blames dispatch; for
 * `processing` abandonments it blames a crashed worker.
 *
 * Refund is delegated to the existing `refundForJob` helper (lazy
 * import avoids a circular module graph: refund.ts → db.ts; this
 * file → refund.ts). If the refund itself errors we log + continue —
 * the row is already `failed` and the user will see that; manual
 * reconciliation from credit_ledger can recover credits later.
 */
async function abandonJob(
  jobId: string,
  fromStatus: 'queued' | 'processing',
  attempts: number,
): Promise<void> {
  const { refundForJob } = await import('../lib/refund');
  const db = getDb();

  const message =
    fromStatus === 'queued'
      ? `Job could not be dispatched after ${attempts} attempts.`
      : `Job exceeded the ${PROCESSING_STUCK_AFTER_SECONDS}s processing window — worker likely crashed.`;

  await db
    .update(jobs)
    .set({
      status: 'failed',
      error: {
        code: 'internal_error',
        message,
        stage: 0,
        retryCount: attempts,
      },
      completedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, fromStatus)));

  try {
    await refundForJob(jobId);
  } catch (err) {
    logger.error('recover-stuck-jobs:abandon-refund-failed', {
      jobId,
      err: String(err),
    });
  }

  logger.warn('recover-stuck-jobs:abandoned', { jobId, fromStatus, attempts });
}
