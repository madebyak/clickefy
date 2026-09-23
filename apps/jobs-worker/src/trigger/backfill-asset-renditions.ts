/**
 * `backfillAssetRenditions` — manual-trigger task that gives project
 * assets written before migration 0038 their grid renditions.
 *
 * What is wrong with those rows, and what this fixes per row:
 *
 *   video   `poster_r2_key` holds the VIDEO'S OWN key (generate-job.ts
 *           used to copy `r2Key` across) → a real poster frame, a muted
 *           preview clip, a ThumbHash, and real width/height/duration
 *           where the row has none.
 *   image   no `thumbhash` → a ThumbHash.
 *
 * The original object is never touched. New objects land under derived
 * keys next to it (`<key minus ext>.poster.jpg`, `.preview.mp4`), which
 * is exactly what the generation path writes for new outputs, so a row
 * fixed here is indistinguishable from one generated after 0038.
 *
 * Safety — the same posture as `backfillTemplatePosters`:
 *   - Manual trigger only (no cron). Run from the Trigger.dev dashboard
 *     or CLI when you want it; nothing fires automatically.
 *   - `dryRun` runs the whole pipeline (download, ffmpeg, hashing) but
 *     skips BOTH the R2 writes and the DB UPDATE. Run it once first.
 *   - `limit` caps rows per run (default 25, hard cap 200) so runs stay
 *     short and observable. Newest rows first: they are the ones people
 *     are looking at.
 *   - Per-row try/catch — one broken object cannot abort the batch.
 *   - Upload first, then UPDATE. A failed UPDATE leaves an orphaned
 *     rendition object that the next run simply rewrites; the reverse
 *     order could leave a row pointing at a key that does not exist.
 *   - The UPDATE re-checks the candidate predicate in its WHERE clause,
 *     so a row fixed concurrently (or by the generation path) is left
 *     alone. Re-running the task is always safe.
 *   - Only rendition columns move. `r2_key`, ownership, ordering and
 *     every credit column are untouched.
 */

import { logger, task } from '@trigger.dev/sdk';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { projectAssets } from '@clickfy/db';

import { env } from '../env';
import { getDb } from '../lib/db';
import { buildVideoRenditions, imageThumbhash, persistOutputRenditions } from '../lib/renditions';

interface Payload {
  /** Run everything except the R2 writes and the DB update. */
  dryRun?: boolean;
  /** Rows per run. Default 25, capped at 200. */
  limit?: number;
  /** Restrict to one kind; default is both, videos first. */
  kind?: 'image' | 'video';
  /** Fix only these asset ids (still subject to the candidate predicate). */
  assetIds?: string[];
}

interface RowResult {
  assetId: string;
  kind: 'image' | 'video';
  status: 'updated' | 'dry-run' | 'skipped' | 'error';
  posterR2Key?: string | null;
  previewR2Key?: string | null;
  thumbhash?: boolean;
  error?: string;
}

/**
 * A row that still needs work. Videos: missing or self-referencing
 * poster, or no preview. Images: no thumbhash. Written once so the
 * SELECT and the guarded UPDATE cannot drift apart.
 */
function needsRenditions(kind?: 'image' | 'video') {
  const video = and(
    eq(projectAssets.kind, 'video'),
    or(
      isNull(projectAssets.posterR2Key),
      eq(projectAssets.posterR2Key, projectAssets.r2Key),
      isNull(projectAssets.previewR2Key),
    ),
  );
  const image = and(eq(projectAssets.kind, 'image'), isNull(projectAssets.thumbhash));
  if (kind === 'video') return video;
  if (kind === 'image') return image;
  return or(video, image);
}

export const backfillAssetRenditions = task({
  id: 'backfill-asset-renditions',
  // ~10–20s per video on medium-1x (download + three seeks + one
  // encode) × 200 rows worst case sits well inside this.
  machine: 'medium-1x',
  maxDuration: 60 * 60,
  retry: {
    // Per-row failures are caught inside; the task itself only throws
    // on infrastructure errors (DB unreachable). Retrying the whole run
    // is safe because the candidate predicate excludes fixed rows.
    maxAttempts: 2,
  },

  run: async (payload: Payload) => {
    const dryRun = payload.dryRun ?? false;
    const limit = Math.max(1, Math.min(payload.limit ?? 25, 200));
    logger.info('[renditions] starting', { dryRun, limit, kind: payload.kind ?? 'both' });

    const db = getDb();
    const where = payload.assetIds?.length
      ? and(needsRenditions(payload.kind), inArray(projectAssets.id, payload.assetIds))
      : needsRenditions(payload.kind);

    const rows = await db
      .select({
        id: projectAssets.id,
        kind: projectAssets.kind,
        r2Key: projectAssets.r2Key,
        width: projectAssets.width,
        height: projectAssets.height,
        durationSec: projectAssets.durationSec,
      })
      .from(projectAssets)
      .where(where)
      // Videos first (the visible bug), newest first within a kind.
      .orderBy(sql`CASE WHEN ${projectAssets.kind} = 'video' THEN 0 ELSE 1 END`, desc(projectAssets.createdAt))
      .limit(limit);

    logger.info('[renditions] candidates found', { count: rows.length });
    if (rows.length === 0) {
      return { dryRun, candidatesFound: 0, results: [] satisfies RowResult[] };
    }

    const results: RowResult[] = [];
    for (const row of rows) {
      const r: RowResult = { assetId: row.id, kind: row.kind, status: 'error' };
      try {
        const bytes = await downloadOutput(row.r2Key);

        if (dryRun) {
          // Build without writing: `persistOutputRenditions` would
          // upload, so only the pure builders run here.
          if (row.kind === 'video') {
            const built = await buildVideoRenditions(bytes);
            r.posterR2Key = built.poster ? '(would write)' : null;
            r.previewR2Key = built.preview ? '(would write)' : null;
            r.thumbhash = built.thumbhash !== null;
          } else {
            const ext = row.r2Key.slice(row.r2Key.lastIndexOf('.') + 1);
            r.thumbhash = (await imageThumbhash(bytes, ext)) !== null;
          }
          r.status = 'dry-run';
          results.push(r);
          continue;
        }

        const renditions = await persistOutputRenditions({
          r2Key: row.r2Key,
          kind: row.kind,
          bytes,
          onWarn: (message, detail) => logger.warn(`[renditions] ${message}`, detail),
        });

        // Nothing produced means nothing to record; the row stays a
        // candidate and a later run (or a fixed decoder) picks it up.
        const produced =
          renditions.posterR2Key !== null ||
          renditions.previewR2Key !== null ||
          renditions.thumbhash !== null;
        if (!produced) {
          r.status = 'skipped';
          r.error = 'no rendition could be built';
          results.push(r);
          continue;
        }

        const updated = await db
          .update(projectAssets)
          .set({
            // A poster that failed to extract must not leave the wrong
            // (self-referencing) key behind: null reads as "no poster".
            ...(row.kind === 'video' ? { posterR2Key: renditions.posterR2Key } : {}),
            ...(renditions.previewR2Key ? { previewR2Key: renditions.previewR2Key } : {}),
            ...(renditions.thumbhash ? { thumbhash: renditions.thumbhash } : {}),
            // Fill dimensions only where the row has none — never
            // overwrite a probed value with a guess.
            ...(row.width == null && renditions.width ? { width: renditions.width } : {}),
            ...(row.height == null && renditions.height ? { height: renditions.height } : {}),
            ...(row.durationSec == null && renditions.durationSec
              ? { durationSec: renditions.durationSec }
              : {}),
          })
          .where(and(eq(projectAssets.id, row.id), needsRenditions(row.kind)))
          .returning();

        r.posterR2Key = renditions.posterR2Key;
        r.previewR2Key = renditions.previewR2Key;
        r.thumbhash = renditions.thumbhash !== null;
        r.status = updated.length > 0 ? 'updated' : 'skipped';
        if (updated.length === 0) r.error = 'row was fixed concurrently — left alone';
      } catch (err) {
        r.status = 'error';
        r.error = err instanceof Error ? err.message : String(err);
        logger.warn('[renditions] row failed', { assetId: row.id, error: r.error });
      }
      results.push(r);
    }

    const counts = results.reduce<Record<RowResult['status'], number>>(
      (acc, x) => {
        acc[x.status] = (acc[x.status] ?? 0) + 1;
        return acc;
      },
      { updated: 0, 'dry-run': 0, skipped: 0, error: 0 },
    );
    logger.info('[renditions] done', { dryRun, counts });
    return { dryRun, candidatesFound: rows.length, counts, results };
  },
});

/** The original bytes, via the Worker's public outputs route (no S3 creds here). */
async function downloadOutput(r2Key: string): Promise<Uint8Array> {
  const url = `${env.WORKER_API_URL.replace(/\/$/, '')}/v1/outputs/${r2Key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${r2Key}: ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}
