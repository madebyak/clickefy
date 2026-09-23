/**
 * The grid renditions of a stored asset, as URLs.
 *
 * One rule lives here so every reader agrees on it: a poster key equal
 * to the asset's own key is NOT a poster. Every video filed before
 * migration 0038 carries exactly that (the worker used to copy `r2Key`
 * across), and handing it to a client as `posterUrl` puts an mp4 in an
 * image slot — blank on mobile, a wasted download on web. Until the
 * renditions backfill replaces it, such a row reports no poster and the
 * client falls back to its placeholder.
 */

import { assetUrl } from './asset-url';

export interface RenditionSource {
  r2Key: string;
  posterR2Key?: string | null;
  previewR2Key?: string | null;
  thumbhash?: string | null;
}

export interface RenditionUrls {
  posterUrl: string | null;
  previewUrl: string | null;
  thumbhash: string | null;
}

export function renditionUrls(origin: string, source: RenditionSource): RenditionUrls {
  const poster = source.posterR2Key && source.posterR2Key !== source.r2Key ? source.posterR2Key : null;
  return {
    posterUrl: poster ? assetUrl(origin, poster) : null,
    previewUrl: source.previewR2Key ? assetUrl(origin, source.previewR2Key) : null,
    thumbhash: source.thumbhash ?? null,
  };
}
