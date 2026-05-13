/**
 * `updateJobProgress()` — write a fresh `JobProgress` row onto the
 * jobs table so the polling endpoint (B4) can surface it to mobile.
 *
 * Keeping the helper in its own module makes it trivial to add
 * additional channels later (Trigger.dev `metadata.set`,
 * Cloudflare Pub/Sub for real-time pushes, etc.) without touching
 * the orchestrator.
 */

import { eq } from 'drizzle-orm';

import { jobs, type JobProgress } from '@clickfy/db';

import { getDb } from './db';

export async function updateJobProgress(
  jobId: string,
  progress: JobProgress,
): Promise<void> {
  await getDb().update(jobs).set({ progress }).where(eq(jobs.id, jobId));
}

/**
 * Convenience: turn a stage index + label into a `JobProgress` and
 * persist it. Mobile renders the `message` directly so it should be
 * human-readable, present-tense, and short ("Generating product
 * hero", not "Stage 1 of 2 in progress").
 */
export async function reportStage(
  jobId: string,
  args: { stage: number; totalStages: number; message: string },
): Promise<void> {
  await updateJobProgress(jobId, {
    stage: args.stage,
    totalStages: args.totalStages,
    message: args.message,
  });
}
