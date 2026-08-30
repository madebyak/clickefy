/**
 * Server-side media duration probing, straight from the bytes in R2.
 *
 * WHY THIS EXISTS: Seedance bills a request by (input + output) video
 * duration, so `inputVideoSeconds` is a BILLING input — and a client
 * -claimed duration would let anyone understate it and make us eat the
 * difference (the provider charges on the actual clip). The only
 * trustworthy source is the uploaded file itself. Audio durations are
 * validation inputs (BytePlus enforces per-clip and total caps and a
 * violation fails AFTER the debit), so they are probed too.
 *
 * Workers have no ffprobe; these are minimal container parsers over
 * ranged R2 reads (≤1MB head, ≤1MB tail — never the whole object):
 *
 *   - mp4/mov: the `mvhd` box (movie header) carries timescale +
 *     duration. `moov` sits at the front on faststart files and at the
 *     end otherwise, hence head-then-tail. Fragmented MP4s have no
 *     global mvhd duration — they come back null and the caller
 *     rejects with a clear message (the providers reject them too).
 *   - wav: RIFF chunk walk — `fmt `.byteRate + `data`.size.
 *   - mp3: ID3v2 skip, first frame header, then the Xing/Info VBR
 *     frame-count when present (exact) or a CBR estimate from the
 *     bitrate otherwise (correct for CBR files, approximate for
 *     headerless VBR).
 *
 * Every parse is wrapped in sanity bounds (positive, ≤ 24h) so a
 * false-positive signature match cannot produce a garbage charge.
 */

const MAX_SANE_SECONDS = 86_400;

const HEAD_BYTES = 1_048_576;
const TAIL_BYTES = 1_048_576;

interface RangeBucket {
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

async function readRange(
  bucket: RangeBucket,
  key: string,
  offset: number,
  length: number,
): Promise<Uint8Array | null> {
  if (length <= 0) return null;
  const obj = await bucket.get(key, { range: { offset, length } });
  if (!obj) return null;
  return new Uint8Array(await obj.arrayBuffer());
}

function sane(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_SANE_SECONDS;
}

/* ── mp4 / mov ──────────────────────────────────────────────────────── */

/**
 * Scan a buffer for an `mvhd` box and return its duration in seconds.
 * Signature-scan rather than a strict box walk: `moov` can be anywhere
 * in the window we read, and a walk from a mid-file offset has no
 * anchor. Sanity bounds reject the (rare) false positive inside media
 * data.
 */
function scanMvhd(buf: Uint8Array): number | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // 'm','v','h','d'
  for (let i = 0; i + 32 <= buf.length; i++) {
    if (buf[i] !== 0x6d || buf[i + 1] !== 0x76 || buf[i + 2] !== 0x68 || buf[i + 3] !== 0x64) {
      continue;
    }
    const version = buf[i + 4];
    let timescale: number;
    let duration: number;
    if (version === 0) {
      // v0: version/flags(4) ctime(4) mtime(4) timescale(4) duration(4)
      if (i + 24 > buf.length) continue;
      timescale = view.getUint32(i + 16);
      duration = view.getUint32(i + 20);
    } else if (version === 1) {
      // v1: version/flags(4) ctime(8) mtime(8) timescale(4) duration(8)
      if (i + 40 > buf.length) continue;
      timescale = view.getUint32(i + 24);
      duration = Number(view.getBigUint64(i + 28));
    } else {
      continue;
    }
    if (timescale <= 0) continue;
    const seconds = duration / timescale;
    if (sane(seconds)) return seconds;
  }
  return null;
}

/* ── wav ────────────────────────────────────────────────────────────── */

function parseWav(buf: Uint8Array, totalSize: number): number | null {
  if (buf.length < 44) return null;
  const ascii = (off: number, len: number) =>
    String.fromCharCode(...buf.subarray(off, off + len));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let byteRate = 0;
  let dataSize = 0;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = ascii(off, 4);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ' && off + 16 + 8 <= buf.length) {
      byteRate = view.getUint32(off + 8 + 8, true);
    } else if (id === 'data') {
      dataSize = size;
      break;
    }
    off += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (byteRate <= 0) return null;
  // `data` not inside the window we read (unusual): approximate from
  // the file size minus everything before where the walk stopped.
  if (dataSize <= 0) dataSize = Math.max(0, totalSize - off - 8);
  const seconds = dataSize / byteRate;
  return sane(seconds) ? seconds : null;
}

/* ── mp3 ────────────────────────────────────────────────────────────── */

// kbps by [mpeg1?][bitrateIndex] for Layer III.
const MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MP3_RATES_V1 = [44_100, 48_000, 32_000];
const MP3_RATES_V2 = [22_050, 24_000, 16_000];
const MP3_RATES_V25 = [11_025, 12_000, 8_000];

function parseMp3(buf: Uint8Array, totalSize: number): number | null {
  let off = 0;
  // ID3v2: 'ID3' + version(2) + flags(1) + syncsafe size(4).
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size =
      ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
    off = 10 + size;
  }
  // Find the first frame sync.
  for (; off + 4 <= buf.length; off++) {
    if (buf[off] === 0xff && (buf[off + 1]! & 0xe0) === 0xe0) break;
  }
  if (off + 4 > buf.length) return null;

  const b1 = buf[off + 1]!;
  const b2 = buf[off + 2]!;
  const versionBits = (b1 >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  const layerBits = (b1 >> 1) & 0x03; // 1 = Layer III
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const rateIndex = (b2 >> 2) & 0x03;
  if (layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;

  const mpeg1 = versionBits === 3;
  const sampleRate = (mpeg1 ? MP3_RATES_V1 : versionBits === 2 ? MP3_RATES_V2 : MP3_RATES_V25)[
    rateIndex
  ]!;
  const samplesPerFrame = mpeg1 ? 1152 : 576;

  // Xing/Info header (VBR): exact frame count. It sits after the frame
  // header + side info (32B stereo / 17B mono on MPEG1; 17/9 on MPEG2).
  const channelMode = (buf[off + 3]! >> 6) & 0x03;
  const sideInfo = mpeg1 ? (channelMode === 3 ? 17 : 32) : channelMode === 3 ? 9 : 17;
  const xingOff = off + 4 + sideInfo;
  if (xingOff + 12 <= buf.length) {
    const tag = String.fromCharCode(...buf.subarray(xingOff, xingOff + 4));
    if (tag === 'Xing' || tag === 'Info') {
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const flags = view.getUint32(xingOff + 4);
      if (flags & 0x1) {
        const frames = view.getUint32(xingOff + 8);
        const seconds = (frames * samplesPerFrame) / sampleRate;
        if (sane(seconds)) return seconds;
      }
    }
  }

  // CBR estimate: audio bytes / bitrate.
  const kbps = (mpeg1 ? MP3_BITRATES_V1 : MP3_BITRATES_V2)[bitrateIndex]!;
  const seconds = ((totalSize - off) * 8) / (kbps * 1000);
  return sane(seconds) ? seconds : null;
}

/* ── public API ─────────────────────────────────────────────────────── */

/**
 * Duration of an mp4/mov in R2, or null when it cannot be determined
 * (fragmented file, truncated upload, unknown container). Callers must
 * treat null as a REJECTION, not as zero — this number feeds billing.
 */
export async function probeVideoDurationSeconds(
  bucket: RangeBucket,
  r2Key: string,
  sizeBytes: number,
): Promise<number | null> {
  const head = await readRange(bucket, r2Key, 0, Math.min(HEAD_BYTES, sizeBytes));
  if (head) {
    const fromHead = scanMvhd(head);
    if (fromHead != null) return fromHead;
  }
  if (sizeBytes > HEAD_BYTES) {
    const tailLen = Math.min(TAIL_BYTES, sizeBytes - HEAD_BYTES);
    const tail = await readRange(bucket, r2Key, sizeBytes - tailLen, tailLen);
    if (tail) {
      const fromTail = scanMvhd(tail);
      if (fromTail != null) return fromTail;
    }
  }
  return null;
}

/** Duration of a wav/mp3 in R2, or null when unparseable. */
export async function probeAudioDurationSeconds(
  bucket: RangeBucket,
  r2Key: string,
  sizeBytes: number,
  mimeType: string,
): Promise<number | null> {
  const head = await readRange(bucket, r2Key, 0, Math.min(HEAD_BYTES, sizeBytes));
  if (!head) return null;
  const mime = mimeType.toLowerCase();
  if (mime.includes('wav')) return parseWav(head, sizeBytes);
  return parseMp3(head, sizeBytes);
}
