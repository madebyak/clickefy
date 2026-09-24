/**
 * Content sniffing for user uploads — trust the bytes, not the header.
 *
 * Lives in @clickfy/types so it can be unit-tested against real file
 * headers; the API's upload routes are the only runtime consumer.
 */

/**
 * Detect a file's actual media type from its leading bytes — the
 * "magic number" signature defined by each format spec. Returns
 * `null` for anything we don't recognise (the caller should reject).
 *
 * Why this exists, given we already validate `Content-Type` at
 * presign and store it in R2:
 *   - With `aws4fetch` + `signQuery: true`, the presigned URL only
 *     signs `host`. The client controls what `Content-Type` header
 *     it sends with the PUT, and R2 stores that verbatim. A
 *     malicious or buggy client can claim `image/jpeg` and send
 *     arbitrary bytes.
 *   - Downstream AI providers receive `mimeType` + bytes; if the
 *     mime says JPEG but the bytes are something else, the provider
 *     errors out after we've already debited credits.
 *
 * This function is the authoritative check: trust the bytes, not
 * the header. 12 bytes is enough for every format we accept.
 *
 * Format signatures (from each spec):
 *   - JPEG       : FF D8 FF                                (3 bytes, any JFIF/Exif variant)
 *   - PNG        : 89 50 4E 47 0D 0A 1A 0A                 (8 bytes, full PNG signature)
 *   - WebP       : "RIFF"....   "WEBP"                     (4+4+4, ASCII RIFF container w/ WEBP type)
 *   - HEIC/HEIF  : ?? ?? ?? ?? "ftyp" + brand              (ISOBMFF; brand at offset 8)
 *   - MP4 / MOV  : ?? ?? ?? ?? "ftyp" + brand              (same ISOBMFF; brand distinguishes them)
 *
 * ISOBMFF brands we accept (offset 8..12 ASCII):
 *   - `heic`, `heix`, `mif1`, `msf1`, `heim`, `heis`       → image/heic
 *   - `mp42`, `mp41`, `isom`, `iso2`…`iso6`, `dash`, `avc1`,
 *     `M4V `, `3gp4`…`3gp6`, `mp4v`, `f4v `, `XAVC`         → video/mp4
 *   - `qt  `                                                → video/quicktime
 *
 * MP4 and QuickTime are the SAME container family (ISOBMFF); only the
 * brand differs, and `mimesAgree` treats them as one class — see there.
 *
 * References:
 *   - https://en.wikipedia.org/wiki/List_of_file_signatures
 *   - ISO/IEC 14496-12 (ISOBMFF), section 4.3 ftyp box
 */
export function detectMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;

  // JPEG — FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP — "RIFF" + 4 size bytes + "WEBP"
  const ascii4 = (offset: number) =>
    String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
  if (ascii4(0) === 'RIFF' && ascii4(8) === 'WEBP') {
    return 'image/webp';
  }

  // WAV — "RIFF" + 4 size bytes + "WAVE"
  if (ascii4(0) === 'RIFF' && ascii4(8) === 'WAVE') {
    return 'audio/wav';
  }

  // MP3 — "ID3" tag header, or a bare MPEG frame sync (FF Ex)
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)
  ) {
    return 'audio/mpeg';
  }

  // ISOBMFF (HEIC/HEIF/MP4/MOV) — "ftyp" at offset 4, brand at offset 8
  if (ascii4(4) === 'ftyp') {
    const brand = ascii4(8);
    if (
      brand === 'heic' ||
      brand === 'heix' ||
      brand === 'mif1' ||
      brand === 'msf1' ||
      brand === 'heim' ||
      brand === 'heis'
    ) {
      return 'image/heic';
    }
    if (brand === 'qt  ') {
      return 'video/quicktime';
    }
    // MP4-family brands. There are many in the wild; this list covers
    // every brand we've seen come out of an iPhone camera, Android
    // camera, or recent video editor. Adding to it is safe — false
    // positives just mean we accept the file, and every provider we
    // send video to decodes the whole ISOBMFF family alike.
    //
    //   isom/iso2..iso6/mp41/mp42/avc1  ISO base media, the common ones
    //   dash                            fragmented MP4 from an encoder
    //   M4V                             Apple's video-with-metadata .m4v
    //   3gp4/3gp5/3gp6                  older Android and feature phones
    //   mp4v / f4v                      Flash-era encoders still in use
    //   XAVC                            Sony cameras (an MP4 profile)
    //
    // NOT here on purpose: `M4A ` is the AUDIO twin of M4V and must
    // not be reported as video.
    if (
      brand === 'mp42' ||
      brand === 'mp41' ||
      brand === 'isom' ||
      brand === 'iso2' ||
      brand === 'iso3' ||
      brand === 'iso4' ||
      brand === 'iso5' ||
      brand === 'iso6' ||
      brand === 'dash' ||
      brand === 'avc1' ||
      brand === 'M4V ' ||
      brand === '3gp4' ||
      brand === '3gp5' ||
      brand === '3gp6' ||
      brand === 'mp4v' ||
      brand === 'f4v ' ||
      brand === 'XAVC'
    ) {
      return 'video/mp4';
    }
  }

  return null;
}

/**
 * Two mimes "agree" for finalize-time validation purposes:
 *   - HEIC and HEIF are functionally interchangeable (same ISOBMFF
 *     container, identical decoder pipeline). The picker on iOS
 *     reports both; treating them as a single class avoids spurious
 *     rejections when the client claims one and the bytes match
 *     the other.
 *   - Everything else must match exactly.
 */
export function mimesAgree(a: string, b: string): boolean {
  if (a === b) return true;
  // Each set is one format under several registered/legacy names. The
  // sniffer returns the canonical member; the client may have declared
  // any of them (browsers report `audio/mp3` on Chrome, `audio/x-wav`
  // on Safari, and so on). Rejecting those as a "mismatch" is what made
  // every web audio upload die at finalize with a red icon.
  const aliasSets: ReadonlyArray<ReadonlySet<string>> = [
    new Set(['image/heic', 'image/heif']),
    new Set(['audio/mpeg', 'audio/mp3']),
    new Set(['audio/wav', 'audio/x-wav', 'audio/wave']),
    // MP4 and QuickTime are one ISOBMFF container family with different
    // brand tags. Browsers derive `file.type` from the EXTENSION, and
    // QuickTime Player, iMovie and Final Cut all write a `qt  ` brand
    // when asked to "export as MP4" — so a perfectly ordinary
    // H.264/AAC clip named `.mp4` arrives declared `video/mp4` and
    // sniffs as `video/quicktime`. Every decoder and every provider we
    // send video to reads both identically. Rejecting the pair turned
    // away real customers' clips (2026-09-24, `new2.mp4`: brand `qt  `,
    // H.264 854x480 + AAC) that other tools accepted without comment.
    // `video/x-m4v` is what Safari and Finder declare for a `.m4v`,
    // whose bytes are plain MP4 (brand `M4V `).
    new Set(['video/mp4', 'video/quicktime', 'video/x-m4v']),
  ];
  return aliasSets.some((set) => set.has(a) && set.has(b));
}
