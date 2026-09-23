/**
 * Renditions — the grid-sized companions of one generated output.
 *
 * The original file is the product: the viewer plays it, the download
 * saves it, nothing here touches it. Grids need something lighter,
 * which is what every mature media product ships next to the original:
 *
 *   video →  poster.jpg   one real frame, so a still view has a picture
 *            preview.mp4  muted, ~640px long edge, low bitrate, capped
 *                         length — what a grid autoplays instead of
 *                         decoding the full clip
 *            thumbhash    placeholder of the poster
 *   image →  thumbhash    placeholder of the image (Cloudflare resizes
 *                         the image itself on demand; nothing to store)
 *
 * ThumbHash over BlurHash: it encodes the aspect ratio and alpha, and
 * expo-image decodes it natively. Pixels come from ffmpeg (a tiny RGBA
 * dump), so no native image library enters the worker.
 *
 * Keys sit next to the original so they are derivable by convention and
 * served by the same route with the same immutable caching:
 *
 *   jobs/<jobId>/stage1-0.mp4
 *   jobs/<jobId>/stage1-0.poster.jpg
 *   jobs/<jobId>/stage1-0.preview.mp4
 *
 * Everything here is best-effort by contract: a caller that cannot get
 * a rendition still has the original, and a generation is never failed
 * — or even delayed past its own upload — over a thumbnail.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { rgbaToThumbHash } from 'thumbhash';

import {
  probeDimensions,
  probeDuration,
  runFfmpeg,
  runFfmpegToBuffer,
  withTempDir,
} from './ffmpeg';
import { writeOutputBytes } from './r2';

/** Long edge of the poster JPEG — 2x a card, same as template covers. */
const POSTER_MAX_EDGE = 1280;
/** Long edge of the preview clip. 640 gives 640x360 / 360x640. */
const PREVIEW_MAX_EDGE = 640;
/** A grid loop never needs more than this; bounds encode time and bytes. */
const PREVIEW_MAX_SECONDS = 10;
/** ThumbHash wants ≤100px on each side; 64 is plenty for a placeholder. */
const THUMBHASH_MAX_EDGE = 64;
/** Where in the clip to look for a representative frame. */
const POSTER_CANDIDATES = [0.25, 0.5, 0.75];

export interface VideoRenditions {
  /** Probed from the container; 0 when ffprobe could not tell. */
  width: number;
  height: number;
  durationSec: number;
  poster: { bytes: Uint8Array; width: number; height: number } | null;
  preview: Uint8Array | null;
  thumbhash: string | null;
}

/** What a persisted output carries in addition to its own key. */
export interface OutputRenditionKeys {
  posterR2Key: string | null;
  previewR2Key: string | null;
  thumbhash: string | null;
  /** Real clip dimensions/length when probed; undefined for images. */
  width?: number;
  height?: number;
  durationSec?: number;
}

const NO_RENDITIONS: OutputRenditionKeys = {
  posterR2Key: null,
  previewR2Key: null,
  thumbhash: null,
};

/**
 * Build every rendition of a video from its bytes. Each piece fails on
 * its own (a clip whose poster extraction fails can still get a preview),
 * so the result is always usable — the caller decides what to store.
 */
export async function buildVideoRenditions(bytes: Uint8Array): Promise<VideoRenditions> {
  return withTempDir('rend-', async (dir) => {
    const input = join(dir, 'input.mp4');
    await writeFile(input, bytes);

    const [dims, duration] = await Promise.all([
      probeDimensions(input).catch(() => ({ width: 0, height: 0 })),
      probeDuration(input).catch(() => Number.NaN),
    ]);
    const durationSec = Number.isFinite(duration) && duration > 0 ? duration : 0;

    const poster = await extractPoster(dir, input, durationSec).catch(() => null);
    const preview = await encodePreview(dir, input).catch(() => null);
    const thumbhash = poster
      ? await thumbhashOf(join(dir, 'poster.jpg'), poster.width, poster.height).catch(() => null)
      : null;

    return { width: dims.width, height: dims.height, durationSec, poster, preview, thumbhash };
  });
}

/** ThumbHash of an image output, or null when ffmpeg cannot decode it. */
export async function imageThumbhash(bytes: Uint8Array, extension: string): Promise<string | null> {
  return withTempDir('rend-', async (dir) => {
    const input = join(dir, `input.${extension}`);
    await writeFile(input, bytes);
    const { width, height } = await probeDimensions(input);
    if (width <= 0 || height <= 0) return null;
    return thumbhashOf(input, width, height);
  }).catch(() => null);
}

/**
 * Build and store the renditions of one persisted output. Never throws:
 * a failure logs through `onWarn` and the output keeps whatever pieces
 * did succeed (worst case: none, which is exactly today's state).
 */
export async function persistOutputRenditions(args: {
  r2Key: string;
  kind: 'image' | 'video';
  bytes: Uint8Array;
  onWarn: (message: string, detail: Record<string, unknown>) => void;
}): Promise<OutputRenditionKeys> {
  const { r2Key, kind, bytes, onWarn } = args;
  try {
    if (kind === 'image') {
      const thumbhash = await imageThumbhash(bytes, extensionOf(r2Key));
      return { ...NO_RENDITIONS, thumbhash };
    }

    const built = await buildVideoRenditions(bytes);
    const base = stripExtension(r2Key);
    let posterR2Key: string | null = null;
    let previewR2Key: string | null = null;

    if (built.poster) {
      const key = `${base}.poster.jpg`;
      await writeOutputBytes({ r2Key: key, bytes: built.poster.bytes, mimeType: 'image/jpeg' });
      posterR2Key = key;
    }
    if (built.preview) {
      const key = `${base}.preview.mp4`;
      await writeOutputBytes({ r2Key: key, bytes: built.preview, mimeType: 'video/mp4' });
      previewR2Key = key;
    }

    return {
      posterR2Key,
      previewR2Key,
      thumbhash: built.thumbhash,
      width: built.width > 0 ? built.width : undefined,
      height: built.height > 0 ? built.height : undefined,
      durationSec: built.durationSec > 0 ? built.durationSec : undefined,
    };
  } catch (err) {
    onWarn('renditions failed — output keeps its original only', {
      r2Key,
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return NO_RENDITIONS;
  }
}

/** `jobs/<id>/stage1-0.mp4` → `jobs/<id>/stage1-0` */
export function stripExtension(r2Key: string): string {
  const dot = r2Key.lastIndexOf('.');
  const slash = r2Key.lastIndexOf('/');
  return dot > slash ? r2Key.slice(0, dot) : r2Key;
}

function extensionOf(r2Key: string): string {
  const dot = r2Key.lastIndexOf('.');
  const slash = r2Key.lastIndexOf('/');
  return dot > slash ? r2Key.slice(dot + 1).toLowerCase() : 'bin';
}

// ─── ffmpeg steps ───────────────────────────────────────────────────

/**
 * One JPEG frame: three candidates across the clip, keep the largest
 * file. Bytes are a cheap proxy for detail — a flat or black frame
 * compresses to almost nothing — and the same heuristic already picks
 * template covers. Writes the winner to `<dir>/poster.jpg`.
 */
async function extractPoster(
  dir: string,
  input: string,
  durationSec: number,
): Promise<VideoRenditions['poster']> {
  const candidates: Array<{ bytes: Uint8Array; width: number; height: number; path: string }> = [];
  // A clip whose length is unknown still yields frame 0.
  const points = durationSec > 0 ? POSTER_CANDIDATES.map((p) => p * durationSec) : [0];

  for (const [i, seekSec] of points.entries()) {
    const out = join(dir, `cand-${i}.jpg`);
    try {
      await runFfmpeg([
        // `-ss` before `-i` seeks without decoding what precedes it.
        '-ss', seekSec.toFixed(3),
        '-i', input,
        '-frames:v', '1',
        '-q:v', '3',
        '-vf', fitFilter(POSTER_MAX_EDGE),
        '-y',
        out,
      ]);
      const [bytes, dims] = await Promise.all([readFile(out), probeDimensions(out)]);
      if (bytes.length > 0 && dims.width > 0) candidates.push({ bytes, ...dims, path: out });
    } catch {
      // One bad seek must not cost the poster; the other candidates stand.
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.bytes.length - a.bytes.length);
  const best = candidates[0]!;
  await writeFile(join(dir, 'poster.jpg'), best.bytes);
  return { bytes: best.bytes, width: best.width, height: best.height };
}

/** Muted, faststart H.264 at a grid-sized edge. Writes `<dir>/preview.mp4`. */
async function encodePreview(dir: string, input: string): Promise<Uint8Array> {
  const out = join(dir, 'preview.mp4');
  await runFfmpeg([
    '-i', input,
    '-t', String(PREVIEW_MAX_SECONDS),
    '-an',
    '-vf', fitFilter(PREVIEW_MAX_EDGE),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '30',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    out,
  ]);
  return readFile(out);
}

/**
 * ThumbHash of any still ffmpeg can decode: dump a ≤64px RGBA frame to
 * stdout and hash it.
 */
async function thumbhashOf(input: string, width: number, height: number): Promise<string> {
  const scale = Math.min(1, THUMBHASH_MAX_EDGE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const rgba = await runFfmpegToBuffer([
    '-i', input,
    '-frames:v', '1',
    '-vf', `scale=${w}:${h}`,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-',
  ]);
  if (rgba.length !== w * h * 4) {
    throw new Error(`thumbhash: expected ${w * h * 4} bytes, got ${rgba.length}`);
  }
  return Buffer.from(rgbaToThumbHash(w, h, rgba)).toString('base64');
}

/** Scale so the long edge is `edge`, never upscaling, keeping both sides even. */
function fitFilter(edge: number): string {
  return `scale='if(gt(iw,ih),min(${edge},iw),-2)':'if(gt(iw,ih),-2,min(${edge},ih))'`;
}
