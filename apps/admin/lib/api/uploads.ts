/**
 * Image upload helpers for the templates editor.
 *
 * The Worker's `/v1/admin/uploads` endpoint accepts a file + folder
 * and returns `{ key, url }`. Templates need a richer return — the
 * `MediaRef` JSONB column expects `{ r2Key, width, height, blurhash,
 * cdnUrl? }` — so we measure the image client-side before persisting
 * it on the template row.
 *
 * Why client-side measurement?
 *   - The Worker bucket isn't doing any image processing today (no
 *     `wrangler-images` binding wired), so dimensions would otherwise
 *     come from the admin form anyway.
 *   - Loading the image in a hidden `<img>` is free and gives us
 *     intrinsic dimensions immediately, which we need for the mobile
 *     layout (aspect-ratio constraints in the card / detail components).
 */

import type { MediaRef } from '@clickfy/types';

import { apiFetch, ApiError, type TokenGetter } from '@/lib/api';

// Mirror the Worker's admin upload rules. HEIC/HEIF are accepted so
// Mac admins can drop straight from Photos — Safari renders them
// natively in <img>; Chrome will fail at the measurement step and
// surface a clean "could not decode" toast before any bytes leave
// the browser. 20 MB image cap matches real-world phone/DSLR JPEGs
// (the old 4 MB cap silently rejected most camera uploads).
export const ACCEPTED_IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;
export const ACCEPTED_VIDEO_MIME = ['video/mp4', 'video/quicktime'] as const;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Soft warning threshold for video uploads. Larger files still go
 * through (up to the hard cap), but we hint the admin to compress
 * first — uncompressed 1080p easily blows past 25 MB at ~10s, and
 * pulling that over a coffee-shop Wi-Fi tanks the editor UX.
 */
export const VIDEO_COMPRESS_HINT_BYTES = 15 * 1024 * 1024;

export interface UploadResult extends MediaRef {
  /** Original file name — surfaced in the admin UI for clarity. */
  fileName: string;
}

interface UploadFolders {
  /** Cover / preview / gallery / reference all live under `templates/`. */
  templates: 'templates';
  /** Category icons. Mirrored from the categories form. */
  categories: 'categories';
}

/**
 * Measure intrinsic dimensions of an image File by loading it into a
 * disposable `<img>` element. Resolves with `{ width, height }` once
 * the browser has parsed the file. Falls back to 0/0 only if decoding
 * fails (callers should treat that as a hard error and surface a toast).
 */
export function measureImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image. Try a different file.'));
    };
    img.src = url;
  });
}

/**
 * Validate, measure, upload to R2 (via the Worker), and return a
 * `MediaRef`-shaped payload ready to drop into `coverMedia`,
 * `gallery[]`, or `references[].r2Key`.
 *
 * Throws `ApiError` on the upload call so callers can show a toast.
 * Validation failures throw plain `Error`s with user-friendly text.
 */
export async function uploadImageAsset(
  file: File,
  folder: keyof UploadFolders,
  getToken: TokenGetter,
): Promise<UploadResult> {
  if (!ACCEPTED_IMAGE_MIME.includes(file.type as (typeof ACCEPTED_IMAGE_MIME)[number])) {
    throw new Error('Image must be JPG, PNG, WebP, or HEIC.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Image must be under ${MAX_UPLOAD_BYTES / 1024 / 1024}MB (this one is ${(file.size / 1024 / 1024).toFixed(1)}MB).`,
    );
  }

  const { width, height } = await measureImage(file);
  if (!width || !height) {
    throw new Error('Could not read image dimensions.');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);

  // The Worker route returns `{ url, key }` — we lift those into a
  // `MediaRef`. `blurhash` is intentionally left empty: encoding it
  // browser-side adds ~100kb of WASM and the placeholder is purely a
  // mobile nicety we can backfill in a later batch job if we want.
  const result = await apiFetch<{ url: string; key: string }>(
    '/v1/admin/uploads',
    { method: 'POST', getToken, formData },
  );

  return {
    r2Key: result.key,
    cdnUrl: result.url,
    width,
    height,
    blurhash: '',
    fileName: file.name,
  };
}

// ─── Video helpers ──────────────────────────────────────────────────

/**
 * Probe a video File for intrinsic dimensions + duration via a hidden
 * `<video>` element. Mirrors `measureImage`, but listens for
 * `loadedmetadata` rather than `load`. Rejects when the browser can't
 * decode the container/codec (e.g. an exotic .mov from an old camera).
 */
export function measureVideo(
  file: File,
): Promise<{ width: number; height: number; durationSec: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      URL.revokeObjectURL(url);
      if (!w || !h) {
        reject(new Error('Could not read video dimensions.'));
        return;
      }
      resolve({ width: w, height: h, durationSec: d });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode video. Try MP4 (H.264) or MOV.'));
    };
    video.src = url;
  });
}

/**
 * Extract the first frame of a video File as a JPEG `Blob`.
 *
 * Used to auto-populate the cover image when an admin uploads a video
 * without a separate poster — gives the mobile `VideoPreview` a poster
 * to crossfade from and ensures the template card still has a still
 * frame to render before/after playback or when video is disabled.
 *
 * Implementation notes:
 *   - We seek to 0.1s rather than 0 because some encoders place the
 *     first keyframe slightly past the file head (the very first frame
 *     can be blank/black on Quicktime exports).
 *   - We cap output dimensions at 1080px on the longest edge. Cover
 *     posters render at <= phone-width; 1080p is plenty and keeps the
 *     JPEG under ~200 KB so the upload is instant.
 *   - JPEG quality 0.85 — visibly indistinguishable from the source
 *     frame and 5–10× smaller than PNG.
 */
export async function captureFirstFrame(file: File): Promise<{
  blob: Blob;
  width: number;
  height: number;
}> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Could not load video for frame capture.'));
      video.src = url;
    });

    // Seek to a sliver past 0 to avoid the rare black first-frame.
    await new Promise<void>((resolve, reject) => {
      const handler = () => {
        video.removeEventListener('seeked', handler);
        resolve();
      };
      video.addEventListener('seeked', handler);
      video.onerror = () => reject(new Error('Could not seek to first frame.'));
      try {
        video.currentTime = Math.min(0.1, (video.duration || 0) / 2);
      } catch (err) {
        reject(err);
      }
    });

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    if (!srcW || !srcH) throw new Error('Video has zero dimensions.');

    // Downscale to a max edge of 1080 — plenty for a card poster, and
    // keeps the JPEG under ~200 KB so the round-trip is instant.
    const MAX_EDGE = 1080;
    const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
    const outW = Math.round(srcW * scale);
    const outH = Math.round(srcH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(video, 0, 0, outW, outH);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85);
    });
    if (!blob) throw new Error('Failed to encode first frame as JPEG.');

    return { blob, width: outW, height: outH };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Validate, measure, optionally capture a poster frame, and upload a
 * video to R2 (via the Worker).
 *
 * Returns:
 *   - `media`: the video `MediaRef` (the `previewVideo` field).
 *   - `poster`: optional image `MediaRef` carrying the auto-extracted
 *     first frame. Callers decide whether to slot it into `coverMedia`
 *     — typically only when the admin hasn't manually picked a cover.
 *
 * Poster extraction is best-effort: if the browser refuses to decode
 * the video frame (rare, but happens on some Safari + .mov combos), we
 * still ship the video upload and return `poster: null`. The mobile
 * `VideoPreview` falls back to the cover image as the poster.
 */
export async function uploadVideoAsset(
  file: File,
  folder: keyof UploadFolders,
  getToken: TokenGetter,
  opts?: { capturePoster?: boolean },
): Promise<{ media: UploadResult; poster: UploadResult | null }> {
  if (!ACCEPTED_VIDEO_MIME.includes(file.type as (typeof ACCEPTED_VIDEO_MIME)[number])) {
    throw new Error('Video must be MP4 (H.264) or MOV.');
  }
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error(
      `Video must be under ${MAX_VIDEO_UPLOAD_BYTES / 1024 / 1024}MB. Try compressing with Handbrake or CloudConvert.`,
    );
  }

  const { width, height } = await measureVideo(file);

  // Capture poster before uploading the video itself: if capture fails
  // we still ship the video; if the video upload fails after a
  // successful capture we just orphan ~200 KB of R2 and that's fine.
  let poster: UploadResult | null = null;
  if (opts?.capturePoster) {
    try {
      const frame = await captureFirstFrame(file);
      const posterFile = new File([frame.blob], `${file.name.replace(/\.[^.]+$/, '')}.poster.jpg`, {
        type: 'image/jpeg',
      });
      poster = await uploadImageAsset(posterFile, folder, getToken);
    } catch (err) {
      // Non-fatal — surface to the console so we can spot pathological
      // codecs in logs, but don't break the user-facing upload flow.
      console.warn('[uploadVideoAsset] poster capture failed:', err);
    }
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);

  const result = await apiFetch<{ url: string; key: string }>(
    '/v1/admin/uploads',
    { method: 'POST', getToken, formData },
  );

  return {
    media: {
      r2Key: result.key,
      cdnUrl: result.url,
      width,
      height,
      blurhash: '',
      fileName: file.name,
    },
    poster,
  };
}

/**
 * Re-export `ApiError` so callers don't need a second import just to
 * type-narrow upload errors.
 */
export { ApiError };
