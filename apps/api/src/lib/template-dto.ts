/**
 * `templateToMobileDTO` — single source of truth for projecting a DB
 * `templates` row down to the shape the mobile app receives.
 *
 * Why this lives in one place:
 *   - The DB row carries admin-only fields (`generation`, `output`) that
 *     would leak prompts and provider config if shipped to clients.
 *   - Media references in the DB are abstract (`MediaRef.r2Key` +
 *     `cdnUrl`), but mobile wants a single fully-resolved URL ready to
 *     plug into `expo-image`.
 *   - Stats roll up into mobile-friendly display strings ("12.4k").
 *
 * Any change to the on-the-wire shape happens here. Add new fields to
 * `MobileTemplate` in `@clickfy/types` first, then teach this helper to
 * fill them.
 */

import type { Template as DbTemplate } from '@clickfy/db';
import type {
  MediaRef,
  MobileImageRef,
  MobileTemplate,
  MobileTemplateOutputSummary,
  MobileVideoRef,
} from '@clickfy/types';

/**
 * Hosts that point at *our own* Worker (past + present). `cdnUrl`
 * values bearing these hosts are stale — we want to ignore them and
 * rebuild the URL from `r2Key` against the *current* request origin,
 * so host migrations (workers.dev → api.clickefy.ai → future custom
 * domain) self-heal without a backfill.
 *
 * NEW host migrations: append the old host here when you cut over,
 * keep it forever — it's the only thing protecting rows written
 * during the previous era.
 */
const OWN_API_HOSTS = new Set([
  'api.clickefy.ai',
  'clickfy-api.clickefy-ai.workers.dev',
]);

/**
 * Resolve a `MediaRef` to a delivery URL.
 *
 * Preference order:
 *   1. `cdnUrl` if it points at a *foreign* CDN (Cloudflare Images
 *      variant, public CDN, etc.) — author intent, keep it.
 *   2. Otherwise rebuild `${publicBaseUrl}/v1/uploads/${r2Key}` from
 *      the live request origin. This catches stored values that point
 *      at one of our own historical hosts (see OWN_API_HOSTS) and
 *      keeps URLs portable across worker.dev / custom-domain cutovers.
 *
 * `publicBaseUrl` is the API origin the client should call. It's passed
 * in (rather than read from env here) so the helper stays pure and
 * testable.
 */
function mediaRefToImage(ref: MediaRef, publicBaseUrl: string): MobileImageRef {
  const url = pickDeliveryUrl(ref, publicBaseUrl);
  return {
    url,
    width: ref.width,
    height: ref.height,
    blurhash: ref.blurhash,
  };
}

/**
 * Resolve `MediaRef` → delivery URL for callers outside this module
 * (e.g. the jobs route's bespoke job-list response). Same self-healing
 * semantics as the internal pickDeliveryUrl.
 */
export function resolveOwnMediaUrl(ref: MediaRef, publicBaseUrl: string): string {
  return pickDeliveryUrl(ref, publicBaseUrl);
}

function pickDeliveryUrl(ref: MediaRef, publicBaseUrl: string): string {
  const fallback = `${publicBaseUrl}/v1/uploads/${ref.r2Key}`;
  if (!ref.cdnUrl) return fallback;
  try {
    const host = new URL(ref.cdnUrl).host;
    if (OWN_API_HOSTS.has(host)) return fallback;
  } catch {
    // Malformed cdnUrl — fall back to the r2Key path.
    return fallback;
  }
  return ref.cdnUrl;
}

/**
 * Resolve a video `MediaRef` to the playback URL + poster URL the
 * mobile player needs. Mirrors `mediaRefToImage` but returns the
 * `MobileVideoRef` shape the SDK flattens into a `previewVideo: string`
 * for `CatalogTemplate`.
 *
 * The poster URL falls back to the cover image when the video record
 * doesn't carry its own poster — that's the common case because the
 * admin form uses the cover image as the still frame underneath the
 * looping clip. Mobile's `VideoPreview` already crossfades the poster
 * to the live video on the first decoded frame.
 */
function mediaRefToVideo(
  ref: MediaRef,
  posterFallback: string,
  publicBaseUrl: string,
): MobileVideoRef {
  return {
    hlsUrl: pickDeliveryUrl(ref, publicBaseUrl),
    posterUrl: posterFallback,
    // Video MediaRef doesn't currently carry duration. We measure
    // dimensions client-side in admin but not duration — `expo-video`
    // reads it from the container on play, so 0 is benign.
    durationSec: 0,
  };
}

/**
 * Project the admin's `output` settings into the per-class summary
 * the mobile UI renders. We never leak the prompt/provider — just
 * the *shape* of what the user receives.
 *
 * `output.type === 'both'` is the `image_then_video` pipeline: one
 * intermediate image plus the final animated video. The user only
 * sees the final video on the result screen, but knowing both will
 * be produced is useful expectation-setting on the template page.
 *
 * If a future template emits N images + M videos in one run, we'd
 * extend the schema with separate `imageCount`/`videoCount` fields
 * — for now this single-count model covers the catalog.
 */
function deriveOutputs(row: DbTemplate): MobileTemplateOutputSummary[] {
  const count = Math.max(1, row.output?.count ?? 1);
  switch (row.output?.type) {
    case 'image':
      return [{ kind: 'image', count }];
    case 'video':
      return [{ kind: 'video', count }];
    case 'both':
      return [
        { kind: 'image', count: 1 },
        { kind: 'video', count: 1 },
      ];
    default:
      // Defensive — `kind` alone tells us the user-facing shape if
      // `output` was somehow missing. Image-set templates map to image.
      return [{ kind: row.kind === 'video' ? 'video' : 'image', count }];
  }
}

export interface MobileDtoOptions {
  /** Origin of the API the mobile app talks to (no trailing slash). */
  publicBaseUrl: string;
}

export function templateToMobileDTO(
  row: DbTemplate,
  opts: MobileDtoOptions,
): MobileTemplate {
  const { publicBaseUrl } = opts;

  const coverImage = mediaRefToImage(row.coverMedia, publicBaseUrl);

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    categoryId: row.categoryId,
    kind: row.kind,
    featured: row.featured,

    coverImage,
    previewVideo: row.previewVideo
      ? mediaRefToVideo(row.previewVideo, coverImage.url, publicBaseUrl)
      : null,
    gallery: row.gallery.map((m) => mediaRefToImage(m, publicBaseUrl)),

    userInputs: row.userInputs,
    userCanChooseAspectRatio: row.userCanChooseAspectRatio,
    defaultAspectRatio: row.defaultAspectRatio,

    outputs: deriveOutputs(row),

    costCredits: row.costCredits,
    successRate: row.stats.successRate,
  };
}
