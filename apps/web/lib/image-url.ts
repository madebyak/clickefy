/**
 * Right-sized URLs for admin-curated browse media — template covers and the
 * images of an image set — through Cloudflare Image Transformations on the
 * API zone. A web port of the mobile helper (apps/mobile/lib/image-url.ts):
 * the originals are full-resolution admin uploads (a set image is ~700 KB),
 * while a card-sized derivative is ~10 KB.
 *
 * Same hard rule as mobile: generation outputs (/v1/outputs/…) are NEVER
 * transformed — users pay for them at full quality. Only an allow-list of
 * admin browse-media paths on the API's own host is rewritten; anything else
 * comes back untouched. `onerror=redirect` makes a failed transform fall back
 * to the original, so this can only ever degrade to "the original image".
 */

/** Only the production API zone has transformations enabled. */
const TRANSFORM_HOSTS = new Set(["api.clickefy.ai"]);

/** Strict allow-list of admin-curated browse-media path prefixes. */
const TRANSFORMABLE_PREFIXES = [
  "/v1/uploads/templates/",
  "/v1/uploads/categories/",
  "/v1/uploads/banners/",
];

/** Candidate widths for `srcset` — few enough to keep the edge cache warm. */
const WIDTHS = [320, 480, 640, 960, 1280] as const;

function eligible(src: string): URL | null {
  try {
    const url = new URL(src);
    if (!TRANSFORM_HOSTS.has(url.hostname)) return null;
    return TRANSFORMABLE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) ? url : null;
  } catch {
    return null;
  }
}

/** A Cloudflare-resized URL for `src` at `width` px, or `src` untouched when it is not eligible. */
export function resizedUrl(src: string, width: number, quality = 80): string {
  const url = eligible(src);
  if (!url) return src;
  // `fit=scale-down` never upscales past the original; `format=auto`
  // negotiates AVIF/WebP from the browser's Accept header.
  const options = [
    `width=${width}`,
    `quality=${quality}`,
    "fit=scale-down",
    "format=auto",
    "onerror=redirect",
  ].join(",");
  // Absolute same-origin path, concatenated (not URL-encoded), per
  // Cloudflare's documented URL format.
  return `${url.origin}/cdn-cgi/image/${options}${url.pathname}${url.search}`;
}

/**
 * `src` + `srcSet` + `sizes` for an <img> of browse media, so the browser
 * downloads only the width its layout and screen density need.
 */
export function responsiveImage(src: string, sizes: string): { src: string; srcSet?: string; sizes?: string } {
  if (!eligible(src)) return { src };
  return {
    src: resizedUrl(src, 640),
    srcSet: WIDTHS.map((w) => `${resizedUrl(src, w)} ${w}w`).join(", "),
    sizes,
  };
}
