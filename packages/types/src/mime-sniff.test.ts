/**
 * Real file headers, not invented ones. `QT_AS_MP4` is the first 16
 * bytes of `new2.mp4` — the customer clip rejected on 2026-09-24 with
 * "File contents (video/quicktime) don't match the declared type
 * (video/mp4)". It is a QuickTime Player export with an .mp4 name:
 * H.264 + AAC, playable everywhere, refused by us alone.
 */

import { describe, expect, it } from 'vitest';

import { detectMimeFromBytes, mimesAgree } from './mime-sniff';

const bytes = (hex: string) => Uint8Array.from(hex.split(' ').map((h) => parseInt(h, 16)));

/** new2.mp4 — `ftyp` + brand `qt  ` */
const QT_AS_MP4 = bytes('00 00 00 14 66 74 79 70 71 74 20 20 00 00 00 00 71 74 20 20');
/** iPhone camera MP4 — `ftyp` + brand `mp42` */
const IPHONE_MP4 = bytes('00 00 00 1c 66 74 79 70 6d 70 34 32 00 00 00 01 6d 70 34 31');
const JPEG = bytes('ff d8 ff e0 00 10 4a 46 49 46 00 01 01 00');
const PNG = bytes('89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52');

describe('detectMimeFromBytes', () => {
  it('reads a qt brand as QuickTime whatever the file is called', () => {
    expect(detectMimeFromBytes(QT_AS_MP4)).toBe('video/quicktime');
  });
  it('reads an mp42 brand as MP4', () => {
    expect(detectMimeFromBytes(IPHONE_MP4)).toBe('video/mp4');
  });
  it('still tells images apart', () => {
    expect(detectMimeFromBytes(JPEG)).toBe('image/jpeg');
    expect(detectMimeFromBytes(PNG)).toBe('image/png');
  });
  it('returns null for too little data or an unknown signature', () => {
    expect(detectMimeFromBytes(bytes('00 00'))).toBe(null);
    expect(detectMimeFromBytes(bytes('00 00 00 00 00 00 00 00 00 00 00 00'))).toBe(null);
  });
});

describe('detectMimeFromBytes — wider ISOBMFF family', () => {
  const ftyp = (brand: string) =>
    bytes('00 00 00 18 66 74 79 70 ' + [...brand].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ') + ' 00 00 00 00');
  it('reads Android 3GP, Flash-era and Sony brands as MP4', () => {
    for (const b of ['3gp4', '3gp5', '3gp6', 'mp4v', 'f4v ', 'XAVC', 'iso4', 'M4V ']) {
      expect(detectMimeFromBytes(ftyp(b)), b).toBe('video/mp4');
    }
  });
  it('does not report the audio-only M4A brand as video', () => {
    expect(detectMimeFromBytes(ftyp('M4A '))).toBe(null);
  });
});

describe('mimesAgree', () => {
  it('accepts a .m4v declared by Safari as video/x-m4v', () => {
    expect(mimesAgree('video/mp4', 'video/x-m4v')).toBe(true);
  });
  it('accepts a QuickTime-branded clip declared as MP4 (the new2.mp4 case)', () => {
    expect(mimesAgree('video/quicktime', 'video/mp4')).toBe(true);
    expect(mimesAgree('video/mp4', 'video/quicktime')).toBe(true);
  });
  it('still rejects a real mismatch', () => {
    expect(mimesAgree('image/jpeg', 'video/mp4')).toBe(false);
    expect(mimesAgree('video/mp4', 'image/png')).toBe(false);
    expect(mimesAgree('audio/mpeg', 'video/mp4')).toBe(false);
  });
  it('keeps the existing alias classes', () => {
    expect(mimesAgree('image/heic', 'image/heif')).toBe(true);
    expect(mimesAgree('audio/wav', 'audio/x-wav')).toBe(true);
    expect(mimesAgree('audio/mpeg', 'audio/mp3')).toBe(true);
  });
});
