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
 * HARD SAFETY RULE — never transform paid generation outputs.
 *
 * User generation results live under `/v1/outputs/...` and MUST always
 * be delivered at their ORIGINAL dimensions and quality (users pay for
 * them). This helper only ever rewrites a strict allow-list of
 * admin-curated browse media:
 *     /v1/uploads/templates/   (covers, galleries, video posters)
 *     /v1/uploads/categories/  (category icons)
 *     /v1/uploads/banners/     (home banners + posters)
 * Anything else — outputs, user input uploads, foreign CDNs, malformed
 * URLs — is returned unchanged. There is intentionally no code path here
 * that can resize an output.
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
  if (!API_HOST) return src;

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return src;
  }

  // Only our own origin, and only admin browse-media prefixes.
  if (parsed.host !== API_HOST) return src;
  if (!TRANSFORMABLE_PREFIXES.some((p) => parsed.pathname.startsWith(p))) {
    return src;
  }

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
