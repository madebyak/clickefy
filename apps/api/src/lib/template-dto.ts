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
  StreamRef,
} from '@clickfy/types';

/**
 * Resolve a `MediaRef` to a delivery URL.
 *
 * Preference order:
 *   1. `cdnUrl` if the admin pasted a fully-qualified URL or the upload
 *      pipeline already wrote a Cloudflare Images variant URL.
 *   2. Fall back to streaming through the Worker's `/v1/uploads/:key`
 *      route — what categories currently use. Phase 2 (CF Images) makes
 *      that fallback rare.
 *
 * `publicBaseUrl` is the API origin the client should call. It's passed
 * in (rather than read from env here) so the helper stays pure and
 * testable.
 */
function mediaRefToImage(ref: MediaRef, publicBaseUrl: string): MobileImageRef {
  const url = ref.cdnUrl ?? `${publicBaseUrl}/v1/uploads/${ref.r2Key}`;
  return {
    url,
    width: ref.width,
    height: ref.height,
    blurhash: ref.blurhash,
  };
}

/**
 * Resolve a `StreamRef` to the HLS manifest + poster URLs the mobile
 * player needs. Stream UIDs deliver via Cloudflare's customer-stream
 * subdomain; we keep the prefix wiring here so callers don't need to
 * know about it.
 */
function streamRefToVideo(
  ref: StreamRef,
  publicBaseUrl: string,
  cloudflareStreamSubdomain: string | undefined,
): MobileVideoRef {
  const stream = cloudflareStreamSubdomain ?? 'customer-default.cloudflarestream.com';
  return {
    hlsUrl: `https://${stream}/${ref.streamId}/manifest/video.m3u8`,
    posterUrl: `${publicBaseUrl}/v1/uploads/${ref.posterR2Key}`,
    durationSec: ref.durationSec,
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
  /** Cloudflare Stream customer subdomain (`customer-xxxx.cloudflarestream.com`). */
  cloudflareStreamSubdomain?: string;
}

export function templateToMobileDTO(
  row: DbTemplate,
  opts: MobileDtoOptions,
): MobileTemplate {
  const { publicBaseUrl, cloudflareStreamSubdomain } = opts;

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    categoryId: row.categoryId,
    kind: row.kind,
    featured: row.featured,

    coverImage: mediaRefToImage(row.coverMedia, publicBaseUrl),
    previewVideo: row.previewVideo
      ? streamRefToVideo(row.previewVideo, publicBaseUrl, cloudflareStreamSubdomain)
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
