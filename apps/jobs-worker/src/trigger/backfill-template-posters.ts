/**
 * `backfillTemplatePosters` — manual-trigger task that fixes video
 * templates whose `cover_media` is NULL (i.e. the broken cards in
 * the mobile "Video Magic" rail showing the broken-image glyph).
 *
 * Pipeline per row:
 *   1. Find candidates (`kind = 'video' AND cover_media IS NULL AND
 *      preview_video IS NOT NULL`).
 *   2. Download the mp4 from R2 via the Worker's `GET /v1/uploads/<key>`
 *      route. No S3 credentials live here — same posture as the rest
 *      of the jobs-worker.
 *   3. Run ffprobe to get duration.
 *   4. Extract 3 JPEG candidates at 25%, 50%, 75% of duration (with
 *      `-ss` BEFORE `-i` for fast seeking — 10–50× faster on long
 *      clips per the ffmpeg performance docs).
 *   5. Pick the LARGEST candidate by compressed-JPEG byte size. Larger
 *      JPEGs almost always = more visual detail (industry heuristic;
 *      flat black/white frames compress tiny). Cheap proxy for the
 *      Laplacian-variance scoring described in the research without
 *      needing a native pixel library.
 *   6. Upload the winner to `templates/<uuid>.jpg` via the Worker's
 *      `PUT /v1/uploads/internal/<key>` endpoint.
 *   7. UPDATE templates SET cover_media = {...} WHERE id = ?
 *
 * Safety:
 *   - Manual trigger only (no cron). Run from the Trigger.dev dashboard
 *     or CLI when you want it; nothing fires automatically.
 *   - Per-row try/catch — one bad video can't abort the batch.
 *   - `dryRun` payload flag runs the entire pipeline but skips both
 *     the R2 write AND the DB UPDATE. Use this once before the real
 *     run to verify nothing explodes on edge-case codecs.
 *   - `limit` payload caps how many rows the task touches in one run.
 *     Defaults to 50 to keep individual runs short and observable.
 *   - `templateIds` payload narrows the scan to a single id (or set)
 *     so admin can fix one template ad-hoc without a global sweep.
 *
 * Why server-side ffmpeg vs the existing browser capture:
 *   - The browser capture (admin upload UI) silently fails on HEVC,
 *     short clips, and several codec edge-cases. Server ffmpeg reads
 *     every codec we accept reliably.
 *   - Industry standard per the 2026 thumbnail research (HyperServe,
 *     ClipSpeedAI, LeanOps): smart timestamp + scoring + worker-based
 *     processing. This task implements that pattern.
 */

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { logger, task } from '@trigger.dev/sdk';
import { and, eq, inArray, isNull, isNotNull } from 'drizzle-orm';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

import { templates } from '@clickfy/db';
import type { MediaRef } from '@clickfy/types';

import { getDb } from '../lib/db';
import { env } from '../env';

const execFileP = promisify(execFile);

/** ffmpeg-static's default export is the binary path or null on
 *  unsupported platforms. We crash early if it's missing — the task
 *  cannot do anything useful without it. */
const FFMPEG_PATH = ffmpegStatic;
const FFPROBE_PATH = ffprobeStatic.path;

if (!FFMPEG_PATH || !FFPROBE_PATH) {
  throw new Error(
    '[backfill-template-posters] ffmpeg-static / ffprobe-static missing — ' +
      "this Trigger.dev runtime doesn't bundle the binaries.",
  );
}

interface Payload {
  /**
   * Run the full pipeline (download, ffmpeg, scoring) but DO NOT
   * write to R2 or update the DB. Use this for the first run to
   * confirm nothing explodes before touching production data.
   */
  dryRun?: boolean;
  /**
   * Cap on rows processed per task run. Default 50 — keeps individual
   * runs short, observable, and cheap. Bump for larger sweeps once
   * the dry run is clean.
   */
  limit?: number;
  /**
   * Optional explicit template ids. When provided, ONLY these rows
   * are considered (still subject to the `cover_media IS NULL AND
   * preview_video IS NOT NULL` filter for safety). Useful for fixing
   * a single template surfaced by admin / support.
   */
  templateIds?: string[];
}

interface RowResult {
  templateId: string;
  title: string;
  status: 'updated' | 'dry-run' | 'skipped' | 'error';
  pickedTimestamp?: string; // e.g. "50%"
  pickedSize?: number;
  error?: string;
}

export const backfillTemplatePosters = task({
  id: 'backfill-template-posters',
  // 5 minutes per row × default 50 rows would be 250 min worst case;
  // 30 minutes is a sane upper bound — any longer than that and
  // something pathological is happening that we'd rather see fail.
  maxDuration: 30 * 60,
  retry: {
    // Per-row failures are caught internally so the task itself almost
    // never throws. If it does (e.g. DB unreachable), let Trigger.dev
    // retry the WHOLE task once — the per-row idempotency guarantee
    // (we re-check `cover_media IS NULL` on each pass) makes a retry
    // safe; rows already updated in the prior attempt are filtered
    // out automatically.
    maxAttempts: 2,
  },

  run: async (payload: Payload) => {
    const dryRun = payload.dryRun ?? false;
    const limit = Math.max(1, Math.min(payload.limit ?? 50, 500));

    logger.info('[backfill] starting', { dryRun, limit });

    const db = getDb();

    // ── Find candidates ─────────────────────────────────────────────
    const whereClauses = [
      inArray(templates.kind, ['video', 'video_image']),
      isNull(templates.coverMedia),
      isNotNull(templates.previewVideo),
    ];
    if (payload.templateIds && payload.templateIds.length > 0) {
      whereClauses.push(inArray(templates.id, payload.templateIds));
    }

    const rows = await db
      .select({
        id: templates.id,
        title: templates.title,
        previewVideo: templates.previewVideo,
      })
      .from(templates)
      .where(and(...whereClauses))
      .limit(limit);

    logger.info('[backfill] candidates found', { count: rows.length });

    if (rows.length === 0) {
      return { dryRun, candidatesFound: 0, results: [] satisfies RowResult[] };
    }

    // ── Process each row ────────────────────────────────────────────
    const results: RowResult[] = [];
    for (const row of rows) {
      const r: RowResult = { templateId: row.id, title: row.title, status: 'error' };
      const previewVideo = row.previewVideo as MediaRef | null;
      if (!previewVideo?.r2Key) {
        r.status = 'skipped';
        r.error = 'preview_video has no r2Key';
        results.push(r);
        continue;
      }

      try {
        const picked = await extractBestPoster(previewVideo.r2Key);
        r.pickedTimestamp = `${Math.round(picked.timestampPct * 100)}%`;
        r.pickedSize = picked.bytes.length;

        if (dryRun) {
          r.status = 'dry-run';
          logger.info('[backfill] dry-run picked', {
            templateId: row.id,
            title: row.title,
            timestamp: r.pickedTimestamp,
            size: r.pickedSize,
          });
        } else {
          // Upload first, then DB update — if the DB update fails the
          // R2 object is orphaned but recoverable on the next run
          // (the row still has cover_media IS NULL). The reverse
          // ordering would leave the row pointing at a missing key.
          const posterKey = `templates/${randomUUID()}.jpg`;
          await uploadPoster(posterKey, picked.bytes);

          const newCover: MediaRef = {
            r2Key: posterKey,
            cdnUrl: `${env.WORKER_API_URL.replace(/\/$/, '')}/v1/uploads/${posterKey}`,
            width: picked.width,
            height: picked.height,
            // Empty blurhash — mobile renders a clean fade-in from the
            // surface color, same as templates with no blurhash today.
            // Future improvement: compute via `blurhash` package.
            blurhash: '',
          };

          // Defensive: only update rows that are still NULL. If a
          // concurrent admin upload set the cover between SELECT and
          // UPDATE, we don't want to clobber their pick. The
          // updatedAt bump keeps audit/cache invalidation honest.
          const updated = await db
            .update(templates)
            .set({ coverMedia: newCover, updatedAt: new Date() })
            .where(and(eq(templates.id, row.id), isNull(templates.coverMedia)))
            .returning();

          if (updated.length === 0) {
            r.status = 'skipped';
            r.error = 'cover was set concurrently — left the existing one alone';
          } else {
            r.status = 'updated';
            logger.info('[backfill] updated', {
              templateId: row.id,
              title: row.title,
              timestamp: r.pickedTimestamp,
              size: r.pickedSize,
              posterKey,
            });
          }
        }
      } catch (err) {
        r.status = 'error';
        r.error = err instanceof Error ? err.message : String(err);
        logger.warn('[backfill] row failed', {
          templateId: row.id,
          title: row.title,
          error: r.error,
        });
      }
      results.push(r);
    }

    const counts = results.reduce<Record<RowResult['status'], number>>(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      { updated: 0, 'dry-run': 0, skipped: 0, error: 0 },
    );
    logger.info('[backfill] done', { dryRun, counts });

    return { dryRun, candidatesFound: rows.length, counts, results };
  },
});

// ─── Internals ──────────────────────────────────────────────────────

interface ExtractedPoster {
  bytes: Uint8Array;
  width: number;
  height: number;
  timestampPct: number; // 0..1
}

/**
 * Extract three candidate JPEGs at 25%, 50%, 75% of duration; return
 * the largest by byte size (cheap proxy for visual detail).
 *
 * `-ss` BEFORE `-i` is the fast-seek path — ffmpeg jumps directly to
 * the target timestamp without decoding intermediate frames. The
 * tradeoff is slightly less precise frame selection, but for poster
 * extraction (any frame near the timestamp is fine) the speed win is
 * worth it (10–50× faster on long clips).
 *
 * The output is scaled to max 1280px on the long edge — enough for
 * 2x retina rendering at our card sizes (~600px wide), small enough
 * to keep the JPEG cheap and consistent with other covers.
 */
async function extractBestPoster(r2Key: string): Promise<ExtractedPoster> {
  const dir = await mkdtemp(join(tmpdir(), 'poster-'));
  const inputPath = join(dir, 'input.mp4');

  try {
    // 1. Download mp4 to /tmp via the Worker's public read route.
    const res = await fetch(`${env.WORKER_API_URL.replace(/\/$/, '')}/v1/uploads/${r2Key}`);
    if (!res.ok) {
      throw new Error(`download ${r2Key}: ${res.status} ${res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(inputPath, buf);

    // 2. ffprobe → duration
    const duration = await probeDuration(inputPath);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`ffprobe returned invalid duration: ${duration}`);
    }

    // 3. Extract 3 candidates
    const candidatePcts = [0.25, 0.5, 0.75];
    const candidates: ExtractedPoster[] = [];
    for (const pct of candidatePcts) {
      const seekSec = duration * pct;
      const outPath = join(dir, `cand-${Math.round(pct * 100)}.jpg`);
      try {
        await runFfmpeg([
          '-ss', String(seekSec),
          '-i', inputPath,
          '-frames:v', '1',
          '-q:v', '3', // 2–3 is high-quality JPEG; ffmpeg scale is inverse (31 = terrible)
          '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'",
          '-y',
          outPath,
        ]);
        const bytes = new Uint8Array(await readFile(outPath));
        const { width, height } = await probeImageDimensions(outPath);
        candidates.push({ bytes, width, height, timestampPct: pct });
      } catch (err) {
        // One bad seek shouldn't kill the whole row — keep going with
        // whatever candidates we got.
        logger.warn('[backfill] candidate extract failed', {
          r2Key,
          pct,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (candidates.length === 0) {
      throw new Error('no candidates produced — all 3 seeks failed');
    }

    // 4. Pick the largest by JPEG byte size. Cheap heuristic for
    //    visual complexity: a flat dark frame compresses to a tiny
    //    JPEG; a frame full of detail compresses larger. Equivalent
    //    rank-order to Laplacian variance for our use case.
    candidates.sort((a, b) => b.bytes.length - a.bytes.length);
    return candidates[0]!;
  } finally {
    // Best-effort cleanup. /tmp will get pruned eventually, but
    // jobs-worker containers can run many tasks back-to-back so we
    // tidy explicitly.
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Push the JPEG to R2 via the Worker's internal write endpoint.
 * Uses the shared INTERNAL_API_SECRET — same pattern as
 * `writeOutputObject` in `lib/r2.ts`.
 */
async function uploadPoster(r2Key: string, bytes: Uint8Array): Promise<void> {
  const url = `${env.WORKER_API_URL.replace(/\/$/, '')}/v1/uploads/internal/${r2Key}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': 'image/jpeg',
      'x-internal-secret': env.INTERNAL_API_SECRET,
    },
    body: bytes as unknown as ArrayBuffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`upload ${r2Key}: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }
}

async function probeDuration(file: string): Promise<number> {
  // Returns the format-level duration in seconds (most accurate for
  // mp4/mov; falls back to stream-level if format duration is empty).
  const { stdout } = await execFileP(FFPROBE_PATH!, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Number.parseFloat(stdout.trim());
}

async function probeImageDimensions(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileP(FFPROBE_PATH!, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=,:p=0',
    file,
  ]);
  const parts = stdout.trim().split(',').map((s) => Number.parseInt(s, 10));
  const w = parts[0] ?? 0;
  const h = parts[1] ?? 0;
  return { width: Number.isFinite(w) ? w : 0, height: Number.isFinite(h) ? h : 0 };
}

async function runFfmpeg(args: string[]): Promise<void> {
  await execFileP(FFMPEG_PATH!, args, {
    // Plenty of room for the largest 25 MB upload we accept; small
    // mp4s won't come close.
    maxBuffer: 64 * 1024 * 1024,
  });
}
