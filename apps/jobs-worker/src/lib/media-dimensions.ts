/**
 * Lightweight image-dimension probing from in-memory bytes — no native
 * deps, no full decode. Reads only fixed header structures:
 *
 *   PNG  — IHDR width/height (big-endian u32 at bytes 16..24)
 *   JPEG — first SOF0/1/2 marker's height/width (big-endian u16)
 *   WebP — VP8 (lossy) / VP8L (lossless) / VP8X (extended) headers
 *
 * Used by the generate-job persist step so `JobResult` carries REAL
 * dimensions and the mobile app can lay outputs out at their true
 * aspect ratio instead of guessing (the "4:3 renders cropped as 3:4"
 * bug). Returns null when the format isn't recognised — callers fall
 * back to the requested aspect ratio.
 */

export interface ProbedDimensions {
  width: number;
  height: number;
}

export function probeImageDimensions(bytes: Uint8Array): ProbedDimensions | null {
  if (bytes.length < 32) return null;

  // ── PNG: 89 50 4E 47 0D 0A 1A 0A, then IHDR ──────────────────────
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width = readU32BE(bytes, 16);
    const height = readU32BE(bytes, 20);
    return valid(width, height);
  }

  // ── JPEG: FF D8, scan for SOF0/SOF1/SOF2 ─────────────────────────
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      // Standalone markers without a length segment.
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      const segLen = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
        const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
        return valid(width, height);
      }
      if (segLen < 2) return null; // corrupt
      i += 2 + segLen;
    }
    return null;
  }

  // ── WebP: RIFF....WEBP ───────────────────────────────────────────
  if (
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    const fourcc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (fourcc === 'VP8 ') {
      // Lossy: 14-bit dims at bytes 26..30, little-endian.
      const width = (bytes[26]! | (bytes[27]! << 8)) & 0x3fff;
      const height = (bytes[28]! | (bytes[29]! << 8)) & 0x3fff;
      return valid(width, height);
    }
    if (fourcc === 'VP8L') {
      // Lossless: signature 0x2F then 14+14 bits packed little-endian.
      if (bytes[20] !== 0x2f) return null;
      const b0 = bytes[21]!;
      const b1 = bytes[22]!;
      const b2 = bytes[23]!;
      const b3 = bytes[24]!;
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return valid(width, height);
    }
    if (fourcc === 'VP8X') {
      // Extended: 24-bit minus-one dims at bytes 24..30, little-endian.
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return valid(width, height);
    }
    return null;
  }

  return null;
}

/**
 * Parse a requested aspect-ratio string ("16:9", "4:3", "1:1") into a
 * width/height number for layout. Returns null for non-numeric values
 * like "adaptive".
 */
export function aspectRatioToNumber(ratio: unknown): number | null {
  if (typeof ratio !== 'string') return null;
  const parts = ratio.split(':');
  if (parts.length !== 2) return null;
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

function readU32BE(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function valid(width: number, height: number): ProbedDimensions | null {
  if (width > 0 && height > 0 && width < 65536 && height < 65536) {
    return { width, height };
  }
  return null;
}
