/**
 * Client-side image compression for AI generation inputs.
 *
 * Why do this on-device instead of letting the Worker handle it:
 *   - Cuts upload bandwidth ~4-10×. A modern iPhone photo is 4-12 MB
 *     of HEIC/HEIF; AI providers want JPEG ≤ ~2 MB and rarely need
 *     more than 2048 px on the long side. Doing the compression
 *     before the upload means we never put the giant original over
 *     a cellular link.
 *   - Saves R2 storage. The Worker stores exactly what we send; if
 *     we send 1 MB instead of 8 MB that's 8× the assets per dollar.
 *   - Normalises format. HEIC/HEIF only work on Apple platforms,
 *     and not all AI providers accept them. JPEG is universally
 *     supported.
 *
 * We don't compress videos here:
 *   - On-device video transcoding is slow (10-60s for short clips)
 *     and the user-perceived "stuck on uploading" tax outweighs the
 *     bandwidth savings.
 *   - Quality drops on a second encode are very visible in video,
 *     where the original is already H.264-compressed by the camera.
 *   - The Worker enforces a 25 MB ceiling, which is plenty for the
 *     4-8s clips we accept.
 *
 * Output is always JPEG. Width × height is clamped to fit within
 * `maxDimension × maxDimension` while preserving the source aspect
 * ratio — never enlarges, never crops.
 */

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export interface CompressedImage {
  /** Local file:// URI of the compressed JPEG in the cache directory. */
  uri: string;
  mimeType: 'image/jpeg';
  /**
   * Size of the compressed file in bytes. Used by the SDK to switch
   * to the presigned-PUT upload path (the multipart route does not
   * need this and ignores it). Best-effort: returns 0 if the file
   * metadata read throws for any reason — the SDK then falls back
   * to the multipart route on its own.
   */
  sizeBytes: number;
}

export interface CompressImageOptions {
  /** Longest-side cap in pixels. Defaults to 2048. */
  maxDimension?: number;
  /** JPEG quality 0..1. Defaults to 0.85 — visually indistinguishable
   *  from the original at typical phone resolutions but ~3× smaller. */
  quality?: number;
}

export async function compressImage(
  sourceUri: string,
  sourceWidth: number,
  sourceHeight: number,
  opts: CompressImageOptions = {},
): Promise<CompressedImage> {
  const maxDim = opts.maxDimension ?? 2048;
  const quality = opts.quality ?? 0.85;

  const context = ImageManipulator.manipulate(sourceUri);

  // Resize only if the source is larger than the cap. We compute the
  // target dimensions ourselves (instead of passing `{ width: maxDim,
  // height: null }`) because the manipulator's "auto" behaviour only
  // preserves ratio when ONE dimension is supplied — and we want
  // *both* dimensions clamped so a portrait photo doesn't end up
  // taller than `maxDim`.
  if (sourceWidth > maxDim || sourceHeight > maxDim) {
    const ratio = sourceWidth / sourceHeight;
    const width = ratio >= 1 ? maxDim : Math.round(maxDim * ratio);
    const height = ratio >= 1 ? Math.round(maxDim / ratio) : maxDim;
    context.resize({ width, height });
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: quality,
  });

  // Read the file size after the save lands on disk. We ignore errors
  // and surface 0 — the SDK treats a non-positive size as "size
  // unknown" and falls back to the multipart upload route, which is
  // slower but always works.
  //
  // Uses the Expo SDK 54 `File` class API. The legacy
  // `FileSystem.getInfoAsync` was removed in expo-file-system v19 —
  // calling it throws at runtime, which historically silently
  // collapsed every upload to the slow multipart fallback.
  // `File#size` is a synchronous getter that returns 0 when the file
  // is missing or unreadable, matching our best-effort contract.
  let sizeBytes = 0;
  try {
    const size = new File(saved.uri).size;
    if (typeof size === 'number' && size > 0) {
      sizeBytes = size;
    }
  } catch (err) {
    console.warn('[compressImage] File size read failed:', err);
  }

  return { uri: saved.uri, mimeType: 'image/jpeg', sizeBytes };
}
