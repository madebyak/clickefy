/**
 * image-url — build right-sized thumbnail URLs for *browse* media using
 * Cloudflare Image Transformations (the built-in `/cdn-cgi/image/` URL
 * endpoint).
 *
 * Why: the feed renders covers into small cards but the stored originals
 * are full-resolution admin uploads (often 1500–2500px, several MB).
 * Downloading + decoding those at full size is the main driver of slow
 * scrolling, high memory, and battery/heat. Asking Cloudflare for a
 * device-sized WebP/AVIF derivative cuts payloads ~10–50× while the
 * original in R2 is never touched.
 *
 * ────────────────────────────────────────────────────────────────────
 * HARD SAFETY RULE — paid generation outputs are only ever REDUCED for
 * grid previews, never for viewing or saving.
 *
 * User generation results live under `/v1/outputs/...`. The expanded
 * viewer and every download MUST deliver the ORIGINAL file (dimensions,
 * quality, ratio — users pay for it). Grid cells, covers and thumbnails
 * may request a device-sized derivative through `outputThumbnailUrl`,
 * which is the ONLY path that touches an output and accepts image
 * formats alone. `thumbnailUrl` keeps its original allow-list of
 * admin-curated browse media:
 *     /v1/uploads/templates/   (covers, galleries, video posters)
 *     /v1/uploads/categories/  (category icons)
 *     /v1/uploads/banners/     (home banners + posters)
 * Anything else — user input uploads, foreign CDNs, malformed URLs — is
 * returned unchanged by both.
 * ────────────────────────────────────────────────────────────────────
 *
 * Mechanism: Cloudflare's `/cdn-cgi/image/<opts>/<source-path>` endpoint
 * is handled at the edge (before our Worker) on any zone with
 * transformations enabled. `format=auto` negotiates AVIF/WebP/JPEG from
 * the client's Accept header automatically, and `onerror=redirect` makes
 * a failed transform fall back to the untouched original — so this can
 * only ever degrade to "original image", never to a broken image.
 */

import { PixelRatio } from 'react-native';

import { config } from './config';

/** Host of our API origin — only media served from here is eligible. */
const API_HOST = (() => {
  try {
    return new URL(config.apiUrl).host;
  } catch {
    return null;
  }
})();

/** Strict allow-list of admin-curated browse-media path prefixes. */
const TRANSFORMABLE_PREFIXES = [
  '/v1/uploads/templates/',
  '/v1/uploads/categories/',
  '/v1/uploads/banners/',
];

/** Never request a derivative wider than this (device px). */
const MAX_DEVICE_WIDTH = 1280;
/** Round requested width up to this bucket to maximise edge-cache hits. */
const WIDTH_BUCKET = 80;

export interface ThumbnailOptions {
  /** Target *layout* width in dp (device-independent px). */
  width: number;
  /**
   * Output quality (1–100). 80 is visually lossless for thumbnails at
   * these sizes while still shrinking payloads dramatically.
   */
  quality?: number;
}

/**
 * Returns a Cloudflare-resized URL for an eligible browse-media `src`,
 * or the original `src` untouched for anything outside the allow-list.
 */
export function thumbnailUrl(
  src: string | undefined | null,
  opts: ThumbnailOptions,
): string | undefined {
  if (!src) return src ?? undefined;
  const parsed = ownOrigin(src);
  if (!parsed) return src;
  if (!TRANSFORMABLE_PREFIXES.some((p) => parsed.pathname.startsWith(p))) {
    return src;
  }
  return transformed(parsed, opts);
}

/** Generation outputs are served from here (see apps/api routes/outputs.ts). */
const OUTPUTS_PREFIX = '/v1/outputs/';
/** Cloudflare can only transform raster images; a video key passes through. */
const OUTPUT_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|avif|gif)$/i;

/**
 * A grid-sized derivative of a generated IMAGE output — for masonry
 * cells, project covers and row thumbnails only. The expanded viewer
 * and Save to Photos must keep using the asset's own `url`.
 *
 * Non-image outputs (video files) and anything off our origin come back
 * untouched, so a caller can pass whatever the asset row holds.
 */
export function outputThumbnailUrl(
  src: string | undefined | null,
  opts: ThumbnailOptions,
): string | undefined {
  if (!src) return src ?? undefined;
  const parsed = ownOrigin(src);
  if (!parsed) return src;
  if (!parsed.pathname.startsWith(OUTPUTS_PREFIX)) return src;
  if (!OUTPUT_IMAGE_EXTENSIONS.test(parsed.pathname)) return src;
  return transformed(parsed, opts);
}

/** Parses `src` and returns it only when it points at our own API host. */
function ownOrigin(src: string): URL | null {
  if (!API_HOST) return null;
  try {
    const parsed = new URL(src);
    return parsed.host === API_HOST ? parsed : null;
  } catch {
    return null;
  }
}

function transformed(parsed: URL, opts: ThumbnailOptions): string {
  const dpr = Math.min(PixelRatio.get() || 1, 3);
  const px = Math.min(
    MAX_DEVICE_WIDTH,
    Math.ceil((opts.width * dpr) / WIDTH_BUCKET) * WIDTH_BUCKET,
  );
  const quality = opts.quality ?? 80;

  // `fit=scale-down` never upscales past the original; `format=auto`
  // picks the best modern format the client supports; `onerror=redirect`
  // falls back to the original asset if the transform ever fails.
  const options = [
    `width=${px}`,
    `quality=${quality}`,
    'fit=scale-down',
    'format=auto',
    'onerror=redirect',
  ].join(',');

  // Source is an absolute same-origin path, concatenated (NOT
  // URL-encoded) per Cloudflare's documented URL format.
  return `${parsed.origin}/cdn-cgi/image/${options}${parsed.pathname}${parsed.search}`;
}
