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
 *     and not all AI providers accept them (Kling video, in
 *     particular, rejects HEIC). JPEG is universally supported.
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
 *
 * EXIF handling:
 *   `ImageManipulator.saveAsync({ format: JPEG })` re-encodes the
 *   pixel buffer through the native graphics pipeline; the EXIF
 *   container from the source file is *not* carried over because
 *   we're producing a new file from raw pixels. This is what we
 *   want — GPS coordinates, capture timestamps, and device serials
 *   from the source photo are dropped before the upload leaves the
 *   device. We further harden the pipeline by passing `exif: false`
 *   into the image picker (see `InputField.tsx`) so the asset
 *   reaching the manipulator is already EXIF-stripped.
 *
 * Two-pass fallback strategy:
 *   The first pass uses the "quality" preset (2048 px, Q=0.85),
 *   which is what AI providers want for best output fidelity. On
 *   failure (typically OOM on huge HEICs or unsupported HEIC
 *   variants — e.g. multi-frame burst HEICs), we retry once with
 *   the "compat" preset (1280 px, Q=0.78). The smaller decode
 *   buffer fits in memory on every device we ship to and the
 *   visual quality drop is invisible at typical render sizes. If
 *   *both* passes throw, we surface the error to the caller — the
 *   wrapper in `InputField.tsx` then blocks the upload and asks the
 *   user to pick a different photo. We deliberately do NOT fall
 *   back to uploading the raw HEIC because credit-burning provider
 *   calls would then fail downstream with a worse error.
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

// Compression presets. The first is what we always try; the second
// kicks in only after a failure. Keeping these as data rather than
// inline literals makes it trivial to add a third preset later (e.g.
// for tablet vs phone) without touching the orchestration logic.
const COMPRESSION_PRESETS = [
  { label: 'quality', maxDim: 2048, quality: 0.85 },
  { label: 'compat', maxDim: 1280, quality: 0.78 },
] as const;

export async function compressImage(
  sourceUri: string,
  sourceWidth: number,
  sourceHeight: number,
  opts: CompressImageOptions = {},
): Promise<CompressedImage> {
  // Caller-supplied opts override the first preset's values but the
  // second preset (compat fallback) is always identical — its job is
  // to be the "smallest viable" pass, not to honour caller intent.
  const firstMaxDim = opts.maxDimension ?? COMPRESSION_PRESETS[0].maxDim;
  const firstQuality = opts.quality ?? COMPRESSION_PRESETS[0].quality;
  const passes = [
    { label: 'quality', maxDim: firstMaxDim, quality: firstQuality },
    COMPRESSION_PRESETS[1],
  ] as const;

  let lastError: unknown = null;
  for (const pass of passes) {
    try {
      return await runSinglePass(sourceUri, sourceWidth, sourceHeight, pass);
    } catch (err) {
      lastError = err;
      console.warn(
        `[compressImage] pass "${pass.label}" failed (${pass.maxDim}px Q=${pass.quality}):`,
        err,
      );
      // Fall through to the next pass. The loop's natural exit either
      // returns a successful CompressedImage or throws after both
      // passes have failed.
    }
  }

  // Both passes failed. Hand the failure up — the caller is expected
  // to render a "we couldn't process this photo" message rather than
  // silently uploading the raw source, because the raw source would
  // burn credits on a provider call that's also going to fail.
  throw lastError instanceof Error
    ? lastError
    : new Error('compressImage: all passes failed');
}

/**
 * One compression attempt. Pulled out of `compressImage()` so the
 * two-pass fallback can call it twice with different presets. Throws
 * on any step (resize, render, save, file-size read) so the caller's
 * for-loop can advance to the next pass.
 */
async function runSinglePass(
  sourceUri: string,
  sourceWidth: number,
  sourceHeight: number,
  pass: { maxDim: number; quality: number },
): Promise<CompressedImage> {
  const context = ImageManipulator.manipulate(sourceUri);

  // Resize only if the source is larger than the cap. We compute the
  // target dimensions ourselves (instead of passing `{ width: maxDim,
  // height: null }`) because the manipulator's "auto" behaviour only
  // preserves ratio when ONE dimension is supplied — and we want
  // *both* dimensions clamped so a portrait photo doesn't end up
  // taller than `maxDim`.
  if (sourceWidth > pass.maxDim || sourceHeight > pass.maxDim) {
    const ratio = sourceWidth / sourceHeight;
    const width = ratio >= 1 ? pass.maxDim : Math.round(pass.maxDim * ratio);
    const height = ratio >= 1 ? Math.round(pass.maxDim / ratio) : pass.maxDim;
    context.resize({ width, height });
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: pass.quality,
    // `base64: false` is the default, but stating it explicitly makes
    // it obvious we're not pulling the entire image into JS memory.
    base64: false,
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
