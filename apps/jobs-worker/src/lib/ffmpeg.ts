/**
 * ffmpeg / ffprobe — the one place the static binaries are resolved and
 * invoked. Shared by the generation pipeline (poster, preview clip and
 * placeholder per output) and the poster backfill tasks, so every task
 * probes and encodes the same way.
 *
 * Binaries come from `FFMPEG_PATH` / `FFPROBE_PATH`: Trigger.dev's
 * `ffmpeg()` build extension (trigger.config.ts) sets both in the
 * deployed image; a dev run sets them in `.env` to a local install
 * (`brew install ffmpeg`). Resolution is lazy so a task that never
 * touches media cannot crash the worker at boot over a missing binary —
 * and every caller treats a rendition as best-effort anyway.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Room for the largest clip we accept plus a raw-frame dump. */
const EXEC_MAX_BUFFER = 64 * 1024 * 1024;

function binaries(): { ffmpeg: string; ffprobe: string } {
  const ffmpeg = process.env.FFMPEG_PATH;
  const ffprobe = process.env.FFPROBE_PATH;
  if (!ffmpeg || !ffprobe) {
    throw new Error(
      '[ffmpeg] FFMPEG_PATH / FFPROBE_PATH are not set — the Trigger.dev ffmpeg build extension sets them in deploys; for dev, install ffmpeg and set both in apps/jobs-worker/.env.',
    );
  }
  return { ffmpeg, ffprobe };
}

/** Run ffmpeg to completion; output goes wherever `args` point it. */
export async function runFfmpeg(args: string[]): Promise<void> {
  await execFileP(binaries().ffmpeg, args, { maxBuffer: EXEC_MAX_BUFFER });
}

/** Run ffmpeg and capture what it writes to stdout (`-f rawvideo -`, etc.). */
export async function runFfmpegToBuffer(args: string[]): Promise<Buffer> {
  const { stdout } = await execFileP(binaries().ffmpeg, args, {
    maxBuffer: EXEC_MAX_BUFFER,
    encoding: 'buffer',
  });
  return stdout;
}

/**
 * Container-level duration in seconds — the accurate figure for mp4/mov.
 * NaN when ffprobe cannot tell; callers decide whether that is fatal.
 */
export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await execFileP(binaries().ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Number.parseFloat(stdout.trim());
}

/** Pixel size of the first video stream — works for stills and clips alike. */
export async function probeDimensions(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileP(binaries().ffprobe, [
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

/**
 * A scratch directory for one media job, removed when `fn` settles.
 * Worker containers run many tasks back to back, so /tmp is tidied
 * explicitly rather than left for the OS.
 */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
