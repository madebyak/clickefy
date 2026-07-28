/**
 * Retention purge — deletes the R2 assets of soft-deleted users once their
 * 30-day grace window has passed. Runs from the Worker's `scheduled`
 * (cron) handler.
 *
 * SAFETY (this touches production storage, so the guarantees matter):
 *   - We ONLY select rows where `is_deleted = true AND purge_assets_at <=
 *     now()`. `purge_assets_at` is written in exactly three places, all of
 *     which also set `is_deleted = true` (account self-delete, the Clerk
 *     `user.deleted` webhook, and admin delete). No active/paying user ever
 *     has it set — the RevenueCat webhook does NOT touch it — so this can
 *     never match a live account.
 *   - Every delete is by a strictly user-/job-scoped key prefix
 *     (`user-uploads/<userId>/`, `avatars/<userId>/`, `jobs/<jobId>/`).
 *     A `userId`/`jobId` is always a DB-issued UUID, never empty, so a
 *     prefix can never widen to someone else's data.
 *   - After a user's assets are gone we clear `purge_assets_at` (keeping
 *     `is_deleted = true`) so the row is never reprocessed. A failure
 *     leaves the timestamp set → it's retried on the next run.
 *   - Work is batched (a handful of users per tick) and each user is
 *     isolated in try/catch so one bad row can't stall the sweep.
 *
 * NOTE: Cloudflare Stream video outputs (`result.videos[].streamId`) are
 * NOT R2 objects and are not deleted here — that needs the Stream API and
 * is tracked as a follow-up. This sweep handles all R2 assets (uploaded
 * inputs, avatars, and image outputs), which is the bulk of stored PII.
 */

import { and, eq, isNotNull, lte } from 'drizzle-orm';

import { createDb, jobs, users } from '@clickfy/db';

import type { Bindings } from '../types';

/** Max users processed per cron tick — keeps well under the CPU budget. */
const BATCH_USERS = 25;

/** Delete every object under a prefix. Paginates + batch-deletes (≤1000/call). */
async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const listing = await bucket.list({ prefix, cursor, limit: 1000 });
    const keys = listing.objects.map((o) => o.key);
    if (keys.length > 0) {
      await bucket.delete(keys);
      deleted += keys.length;
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
  return deleted;
}

export async function purgeDeletedUserAssets(
  env: Bindings,
): Promise<{ users: number; objects: number }> {
  if (!env.DATABASE_URL || !env.UPLOADS || !env.OUTPUTS) {
    console.warn('[purge] missing DATABASE_URL / UPLOADS / OUTPUTS binding — skipping');
    return { users: 0, objects: 0 };
  }
  const db = createDb({ connectionString: env.DATABASE_URL, runtime: 'http' });
  const now = new Date();

  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isDeleted, true),
        isNotNull(users.purgeAssetsAt),
        lte(users.purgeAssetsAt, now),
      ),
    )
    .limit(BATCH_USERS);

  let usersDone = 0;
  let objectsDeleted = 0;

  for (const { id } of due) {
    try {
      // Uploaded inputs + avatars live in UPLOADS, user-scoped.
      objectsDeleted += await deletePrefix(env.UPLOADS, `user-uploads/${id}/`);
      objectsDeleted += await deletePrefix(env.UPLOADS, `avatars/${id}/`);

      // Generated image outputs live in OUTPUTS, keyed `jobs/<jobId>/…`.
      const userJobs = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.userId, id));
      for (const j of userJobs) {
        objectsDeleted += await deletePrefix(env.OUTPUTS, `jobs/${j.id}/`);
      }

      // Mark complete so we never reprocess (row stays soft-deleted).
      await db.update(users).set({ purgeAssetsAt: null }).where(eq(users.id, id));
      usersDone += 1;
    } catch (err) {
      // Leave purge_assets_at set so this user is retried next run.
      console.error('[purge] failed for user', id, err);
    }
  }

  if (usersDone > 0 || objectsDeleted > 0) {
    console.log(`[purge] complete — users=${usersDone} objects=${objectsDeleted}`);
  }
  return { users: usersDone, objects: objectsDeleted };
}
