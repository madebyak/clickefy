/**
 * /v1/uploads             — public read of uploaded assets.
 * /v1/admin/uploads       — admin-only image upload (templates, categories).
 * /v1/uploads/user        — authenticated mobile-user upload (job inputs).
 *
 * Files live in the `UPLOADS` R2 bucket. We serve them through the Worker
 * (rather than exposing the bucket on r2.dev) so we control caching headers
 * and can revoke access by deleting the bucket object.
 *
 * Key conventions:
 *   - `<folder>/<uuid>.<ext>`              for admin uploads
 *     e.g. `categories/abc...png`, `templates/abc...png`
 *   - `user-uploads/<userId>/<uuid>.<ext>` for mobile-user uploads
 *
 * User uploads are namespaced by user id so the job-submission validator
 * (B2) can cheaply check "does this r2Key belong to the calling user?"
 * with a string prefix comparison.
 */

import { AwsClient } from 'aws4fetch';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

import { attachmentDisposition, wantsDownload } from '../lib/content-disposition';
import type { AppEnv } from '../types';
import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, byIp, withRateLimit } from '../middleware/with-rate-limit';

const ALLOWED_FOLDERS = new Set(['categories', 'templates', 'banners']);

// ─── Admin upload limits, per folder ────────────────────────────────
// Templates support an optional preview video (cover poster + short
// looping clip). Categories stay image-only.
//
// 25 MB ceiling for video covers maps to ~30s of 1080p H.264 at a
// reasonable bitrate; longer/bigger clips should be compressed in
// Handbrake / CloudConvert first. The cap is enforced both client-
// and server-side so admins get a friendly toast before the request.
// HEIC/HEIF are intentionally accepted alongside JPEG/PNG/WebP — Mac
// Photos exports HEIC by default and rejecting it surprises admins who
// drag-drop straight from the library. Safari decodes HEIC natively; on
// Chrome the admin-side measurement step (<img>.onload) will fail and
// the form surfaces a clean "could not decode — try JPEG" error before
// any bytes leave the browser, so we never have to teach the Worker
// (or R2 readers) about HEIC.
const ADMIN_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const ADMIN_VIDEO_MIME = new Set(['video/mp4', 'video/quicktime']);
// 20 MB image cap matches real-world phone / DSLR JPEGs (iPhone 14 Pro
// ProRAW JPEG ≈ 7–12 MB, Sony A7 high-quality JPEG ≈ 15 MB). The old
// 4 MB cap silently rejected most camera uploads before the request
// even hit the network.
const ADMIN_MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB
const ADMIN_MAX_VIDEO_BYTES = 25 * 1024 * 1024; // 25 MB

function adminUploadRulesFor(folder: string): {
  mime: Set<string>;
  maxBytes: number;
  mediaClass: 'image' | 'video';
} | null {
  if (folder === 'categories') {
    return { mime: ADMIN_IMAGE_MIME, maxBytes: ADMIN_MAX_IMAGE_BYTES, mediaClass: 'image' };
  }
  if (folder === 'templates') {
    // Caller picks via MIME; we return the union and let the route
    // pick the matching bucket below.
    return { mime: new Set([...ADMIN_IMAGE_MIME, ...ADMIN_VIDEO_MIME]), maxBytes: ADMIN_MAX_VIDEO_BYTES, mediaClass: 'image' };
  }
  if (folder === 'banners') {
    // Banners accept the same image + video MIME set as templates so
    // an admin can compose image / image_slider / video banners with
    // the existing upload UI. Same 25 MB ceiling — banners are
    // typically larger 16:9 hero assets.
    return { mime: new Set([...ADMIN_IMAGE_MIME, ...ADMIN_VIDEO_MIME]), maxBytes: ADMIN_MAX_VIDEO_BYTES, mediaClass: 'image' };
  }
  return null;
}

// ─── User upload limits ─────────────────────────────────────────────
// Mobile photos straight off the camera (iPhone Pro 48MP HEIC) can be
// 6–12MB before transcoding, and we want a comfortable headroom for
// short reference videos. 25MB is a safe ceiling that still rejects
// pathological uploads, and matches what Lensa / Photoroom enforce.
const USER_MAX_BYTES = 25 * 1024 * 1024;
const USER_ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const USER_ALLOWED_VIDEO_MIME = new Set([
  'video/mp4',
  'video/quicktime',
]);
// Seedance reference-audio formats (wav/mp3). BytePlus caps audio clips
// at 15MB; enforcing it at upload beats a rejected job later.
const USER_ALLOWED_AUDIO_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
]);
const USER_MAX_AUDIO_BYTES = 15 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

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
 *   - `mp42`, `mp41`, `isom`, `iso2`, `dash`               → video/mp4
 *   - `qt  `                                                → video/quicktime
 *
 * References:
 *   - https://en.wikipedia.org/wiki/List_of_file_signatures
 *   - ISO/IEC 14496-12 (ISOBMFF), section 4.3 ftyp box
 */
function detectMimeFromBytes(bytes: Uint8Array): string | null {
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
    // positives just mean we accept the file.
    if (
      brand === 'mp42' ||
      brand === 'mp41' ||
      brand === 'isom' ||
      brand === 'iso2' ||
      brand === 'iso5' ||
      brand === 'iso6' ||
      brand === 'dash' ||
      brand === 'avc1' ||
      brand === 'M4V '
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
function mimesAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const heicSet = new Set(['image/heic', 'image/heif']);
  if (heicSet.has(a) && heicSet.has(b)) return true;
  return false;
}

/**
 * Parse a single-range `Range` header (`bytes=START-END`, `bytes=START-`,
 * `bytes=-N`) into resolved `{ start, end }` offsets within `totalSize`.
 * Returns `null` if the syntax is unrecognised (the caller falls back
 * to a full GET) or `{ invalid: true }` if the range is syntactically
 * valid but unsatisfiable (the caller emits 416).
 */
function parseRange(
  rangeHeader: string,
  totalSize: number,
): { start: number; end: number } | { invalid: true } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  let start = match[1] === '' ? NaN : Number(match[1]);
  let end = match[2] === '' ? NaN : Number(match[2]);
  if (Number.isNaN(start) && !Number.isNaN(end)) {
    start = Math.max(0, totalSize - end);
    end = totalSize - 1;
  } else if (!Number.isNaN(start) && Number.isNaN(end)) {
    end = totalSize - 1;
  }
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    end >= totalSize ||
    start > end
  ) {
    return { invalid: true };
  }
  return { start, end };
}

// ─── Public read ────────────────────────────────────────────────────

export const uploadsPublicRoute = new Hono<AppEnv>();

uploadsPublicRoute.get(
  '/:key{.+}',
  withRateLimit((env) => env.RL_PUBLIC_IP, byIp),
  async (c) => {
  const bucket = c.env.UPLOADS;
  if (!bucket) {
    return c.json(
      { error: { code: 'r2_not_configured', message: 'Uploads bucket binding missing.' } },
      503,
    );
  }

  const key = c.req.param('key');

  // ── Range support ──────────────────────────────────────────────
  // Inline video playback on iOS AVPlayer fails without Range — the
  // player issues an initial `bytes=0-1` probe, sees no `accept-ranges`,
  // and refuses to play. Same fix we shipped for /v1/outputs. Images
  // also benefit (none of our clients send Range for images, but the
  // path is identical and cheap).
  const rangeHeader = c.req.header('range');
  if (rangeHeader) {
    const head = await bucket.head(key);
    if (!head) {
      return c.json({ error: { code: 'not_found', message: 'Asset not found.' } }, 404);
    }
    const parsed = parseRange(rangeHeader, head.size);
    if (parsed && 'invalid' in parsed) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${head.size}` },
      });
    }
    if (parsed) {
      const length = parsed.end - parsed.start + 1;
      const ranged = await bucket.get(key, {
        range: { offset: parsed.start, length },
      });
      if (!ranged) {
        return c.json({ error: { code: 'not_found', message: 'Asset not found.' } }, 404);
      }
      const headers = new Headers();
      ranged.writeHttpMetadata(headers);
      headers.set('etag', ranged.httpEtag);
      headers.set('content-length', String(length));
      headers.set('content-range', `bytes ${parsed.start}-${parsed.end}/${head.size}`);
      headers.set('accept-ranges', 'bytes');
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      headers.set('cross-origin-resource-policy', 'cross-origin');
      headers.set('access-control-allow-origin', '*');
      // Same on a 206: a download that starts with a Range request (some
      // managers do) must still be told to save rather than display.
      if (wantsDownload(c.req.query('download'))) {
        headers.set('content-disposition', attachmentDisposition(c.req.query('name'), key));
      }
      return new Response(ranged.body, { status: 206, headers });
    }
    // Unparseable Range — fall through to a full GET. RFC 9110 allows this.
  }

  const obj = await bucket.get(key);
  if (!obj) {
    return c.json({ error: { code: 'not_found', message: 'Asset not found.' } }, 404);
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // Advertise Range so range-capable clients (iOS AVPlayer, Chrome
  // <video>) know they can request slices on subsequent connections.
  // Without this header iOS treats the response as non-seekable and
  // refuses to play multi-MB videos inline.
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(obj.size));
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  // Public assets — must be embeddable from any origin (admin on localhost,
  // mobile app, etc.). Overrides the `same-origin` default set globally by
  // `secureHeaders()` middleware in src/index.ts.
  headers.set('cross-origin-resource-policy', 'cross-origin');
  headers.set('access-control-allow-origin', '*');
  // `?download=1` flips the response from "show this" to "save this".
  // Cross-origin <a download> is ignored by browsers, so this header is
  // what actually makes the studio's download buttons save a file — see
  // lib/content-disposition.ts. The query string is part of the cache
  // key, so the inline and attachment variants cache independently.
  if (wantsDownload(c.req.query('download'))) {
    headers.set('content-disposition', attachmentDisposition(c.req.query('name'), key));
  }
  return new Response(obj.body, { headers });
});

// Explicit HEAD route — Hono doesn't auto-route HEAD to GET handlers,
// and AVPlayer's initial probe is a HEAD on some iOS versions.
uploadsPublicRoute.on('HEAD', '/:key{.+}', withRateLimit((env) => env.RL_PUBLIC_IP, byIp), async (c) => {
  const bucket = c.env.UPLOADS;
  if (!bucket) return c.body(null, 503);
  const key = c.req.param('key');
  const head = await bucket.head(key);
  if (!head) return c.body(null, 404);
  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set('etag', head.httpEtag);
  headers.set('content-length', String(head.size));
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('cross-origin-resource-policy', 'cross-origin');
  headers.set('access-control-allow-origin', '*');
  // `?download=1` flips the response from "show this" to "save this".
  // Cross-origin <a download> is ignored by browsers, so this header is
  // what actually makes the studio's download buttons save a file — see
  // lib/content-disposition.ts. The query string is part of the cache
  // key, so the inline and attachment variants cache independently.
  if (wantsDownload(c.req.query('download'))) {
    headers.set('content-disposition', attachmentDisposition(c.req.query('name'), key));
  }
  return new Response(null, { status: 200, headers });
});

// ─── Internal write (jobs-worker) ───────────────────────────────────
//
// `PUT /v1/uploads/internal/:key` — secret-protected write into the
// UPLOADS bucket from the Trigger.dev jobs-worker.
//
// Use case: server-side asset generation (e.g. `backfill-template-posters`
// extracting a JPEG poster from a video on R2, then writing it back as
// `templates/<uuid>.jpg`). The orchestrator can't use `c.env.UPLOADS`
// directly because it runs in a separate Node process, and we don't
// want S3 credentials living there. Same posture as the existing
// `/v1/outputs/internal/:key` endpoint — see routes/outputs.ts for the
// design rationale.
//
// Auth: shared `INTERNAL_API_SECRET` header, constant-time compared.
// Never user-facing. Mobile / admin clients use the existing
// `POST /v1/admin/uploads` flow which is Clerk-gated.

export const uploadsInternalRoute = new Hono<AppEnv>();

/** Allow only known prefixes so a leaked secret can't write anywhere. */
const INTERNAL_WRITE_PREFIXES = ['templates/', 'categories/', 'banners/'];

uploadsInternalRoute.put('/:key{.+}', async (c) => {
  const secret = c.env.INTERNAL_API_SECRET;
  if (!secret) {
    return c.json(
      { error: { code: 'not_configured', message: 'INTERNAL_API_SECRET missing on Worker.' } },
      503,
    );
  }
  const provided = c.req.header('x-internal-secret');
  if (!provided || !timingSafeEq(provided, secret)) {
    return c.json({ error: { code: 'unauthorized', message: 'Invalid internal secret.' } }, 401);
  }

  const bucket = c.env.UPLOADS;
  if (!bucket) {
    return c.json(
      { error: { code: 'r2_not_configured', message: 'Uploads bucket binding missing.' } },
      503,
    );
  }

  const key = c.req.param('key');
  // Reject obvious key abuse (path traversal, nonsense prefixes).
  if (key.includes('..') || !INTERNAL_WRITE_PREFIXES.some((p) => key.startsWith(p))) {
    return c.json(
      { error: { code: 'invalid_key', message: `Key must start with one of: ${INTERNAL_WRITE_PREFIXES.join(', ')}.` } },
      400,
    );
  }

  const contentType = c.req.header('content-type') ?? 'application/octet-stream';
  const body = c.req.raw.body;
  if (!body) {
    return c.json({ error: { code: 'empty_body', message: 'No body provided.' } }, 400);
  }

  await bucket.put(key, body, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      source: 'jobs-worker-internal',
    },
  });

  return c.json({ data: { key } }, 201);
});

/** Constant-time string compare. Only safe for equal-length inputs. */
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Admin write ────────────────────────────────────────────────────

export const uploadsAdminRoute = new Hono<AppEnv>();

uploadsAdminRoute.post(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
  async (c) => {
    const bucket = c.env.UPLOADS;
    if (!bucket) {
      return c.json(
        { error: { code: 'r2_not_configured', message: 'Uploads bucket binding missing.' } },
        503,
      );
    }

    const form = await c.req.formData();
    const entry = form.get('file');
    const folderRaw = form.get('folder');
    const folder = typeof folderRaw === 'string' ? folderRaw : 'categories';

    if (!isUploadedFile(entry)) {
      return c.json(
        { error: { code: 'invalid_file', message: 'Missing `file` field.' } },
        400,
      );
    }

    const file = entry;
    if (!ALLOWED_FOLDERS.has(folder)) {
      return c.json(
        { error: { code: 'invalid_folder', message: `Folder must be one of: ${[...ALLOWED_FOLDERS].join(', ')}.` } },
        400,
      );
    }
    const rules = adminUploadRulesFor(folder);
    if (!rules) {
      return c.json(
        { error: { code: 'invalid_folder', message: `Folder "${folder}" is not configured for uploads.` } },
        400,
      );
    }
    if (!rules.mime.has(file.type)) {
      return c.json(
        { error: { code: 'invalid_mime', message: `Allowed types for "${folder}": ${[...rules.mime].join(', ')}.` } },
        400,
      );
    }
    // Per-class size limit: images and videos have different ceilings
    // even within the same folder.
    const isVideo = ADMIN_VIDEO_MIME.has(file.type);
    const sizeLimit = isVideo ? ADMIN_MAX_VIDEO_BYTES : ADMIN_MAX_IMAGE_BYTES;
    if (file.size > sizeLimit) {
      return c.json(
        { error: { code: 'file_too_large', message: `Max upload size is ${sizeLimit / 1024 / 1024}MB.` } },
        413,
      );
    }

    const ext = EXT_BY_MIME[file.type] ?? 'bin';
    const key = `${folder}/${crypto.randomUUID()}.${ext}`;

    await bucket.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        uploadedBy: c.var.user?.id ?? 'unknown',
        originalName: file.name,
        mediaClass: isVideo ? 'video' : 'image',
      },
    });

    const origin = new URL(c.req.url).origin;
    const url = `${origin}/v1/uploads/${key}`;

    return c.json({ data: { url, key, mediaClass: isVideo ? 'video' : 'image' } }, 201);
  },
);

// ─── User write (mobile job inputs) ─────────────────────────────────

/**
 * Duck-typed File interface — the worker runtime exposes `FormData`
 * entries as `File | string | null` but the global `File` type isn't
 * always in scope under our Worker tsconfig. Duck-typing keeps the
 * route portable across CF/Node test environments.
 */
interface UploadedFile {
  name: string;
  type: string;
  size: number;
  stream(): ReadableStream<Uint8Array>;
}

function isUploadedFile(v: unknown): v is UploadedFile {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { stream?: unknown }).stream === 'function' &&
    typeof (v as { size?: unknown }).size === 'number'
  );
}

export const uploadsUserRoute = new Hono<AppEnv>();

/**
 * POST /v1/uploads/user
 *
 * Accepts `multipart/form-data` with a single `file` field. The route:
 *
 *   1. Requires a signed-in Clerk user (mobile sends a fresh JWT via
 *      `Authorization: Bearer ...`).
 *   2. Resolves the Neon `users` row so we know the canonical user id
 *      to namespace the R2 key with.
 *   3. Validates content type + size. Type validation is by header
 *      first (cheap) and we trust the client; magic-byte sniffing is
 *      a follow-up if abuse becomes a concern.
 *   4. Writes to `user-uploads/<userId>/<uuid>.<ext>` in R2.
 *   5. Returns `{ key, url, contentType, sizeBytes }` so the mobile
 *      app can show a preview and stash the key for job submission.
 *
 * Auth posture: required. Anonymous uploads aren't supported — every
 * upload must be attributable to a user so the job validator (B2)
 * can enforce per-user ownership of referenced keys.
 */
uploadsUserRoute.post(
  '/',
  withAuth({ required: true }),
  // Upload-specific bucket — see wrangler.toml notes. Lives apart from
  // RL_USER_WRITE so multi-asset attaches can't starve other writes.
  withRateLimit((env) => env.RL_USER_UPLOAD, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const bucket = c.env.UPLOADS;
    if (!bucket) {
      return c.json(
        { error: { code: 'r2_not_configured', message: 'Uploads bucket binding missing.' } },
        503,
      );
    }

    const user = c.var.user;
    if (!user) {
      // `withCurrentUser` ensures this is set when auth is required;
      // the explicit guard satisfies the type narrower below.
      return c.json(
        { error: { code: 'unauthenticated', message: 'Sign-in required.' } },
        401,
      );
    }

    const form = await c.req.formData();
    const entry = form.get('file');
    if (!isUploadedFile(entry)) {
      return c.json(
        { error: { code: 'invalid_file', message: 'Missing `file` field.' } },
        400,
      );
    }

    const file = entry;
    const isImage = USER_ALLOWED_IMAGE_MIME.has(file.type);
    const isVideo = USER_ALLOWED_VIDEO_MIME.has(file.type);
    const isAudio = USER_ALLOWED_AUDIO_MIME.has(file.type);
    if (!isImage && !isVideo && !isAudio) {
      const allowed = [
        ...USER_ALLOWED_IMAGE_MIME,
        ...USER_ALLOWED_VIDEO_MIME,
        ...USER_ALLOWED_AUDIO_MIME,
      ].join(', ');
      return c.json(
        {
          error: {
            code: 'invalid_mime',
            message: `Unsupported file type "${file.type}". Allowed: ${allowed}.`,
          },
        },
        400,
      );
    }
    const maxBytes = isAudio ? USER_MAX_AUDIO_BYTES : USER_MAX_BYTES;
    if (file.size > maxBytes) {
      return c.json(
        {
          error: {
            code: 'file_too_large',
            message: `Max upload size is ${maxBytes / 1024 / 1024}MB.`,
          },
        },
        413,
      );
    }

    const ext = EXT_BY_MIME[file.type] ?? 'bin';
    // R2 keys are flat strings — Cloudflare doesn't have real folders,
    // but slashes still act as a "prefix" for list/delete operations
    // and `key.startsWith(`user-uploads/${userId}/`)` is what the job
    // validator will use to gate access in B2.
    const key = `user-uploads/${user.id}/${crypto.randomUUID()}.${ext}`;

    await bucket.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type,
        // User uploads are short-lived (consumed by a generation run);
        // shorter cache TTL is fine and lets us GC eagerly later.
        cacheControl: 'private, max-age=3600',
      },
      customMetadata: {
        uploadedBy: user.id,
        originalName: file.name,
        // `purpose=job_input` keeps lifecycle policies / cleanup jobs
        // from accidentally treating a user reference image like a
        // long-lived template asset.
        purpose: 'job_input',
      },
    });

    const origin = new URL(c.req.url).origin;
    return c.json(
      {
        data: {
          key,
          url: `${origin}/v1/uploads/${key}`,
          contentType: file.type,
          sizeBytes: file.size,
        },
      },
      201,
    );
  },
);

// ─── Presigned PUT flow ────────────────────────────────────────────
//
// The multipart upload above streams through the Worker — fine for
// small images but slow on cellular and capped by the Worker request-
// body limit. The presigned flow lets the mobile app talk to R2's S3
// endpoint directly:
//
//   1. POST /v1/uploads/user/presign   { contentType, sizeBytes }
//      → returns a short-lived signed PUT URL + the R2 key we want
//        the client to use.
//   2. Client does an HTTP PUT to that URL with the raw file body
//      (`Content-Type` header must match what was presigned).
//      Native XHR gives us upload-progress events for free.
//   3. POST /v1/uploads/user/finalize  { key }
//      → HEAD-checks the object exists, returns the same shape the
//        multipart route returned so the SDK is a drop-in swap.
//
// Why a separate `finalize` call rather than trusting the client to
// say "I uploaded it":
//   - It confirms the object actually landed in the bucket (the
//     client could lie or the PUT could have silently failed).
//   - It centralises the place we record file size and content type
//     into our DB, should we want to add a row in `user_assets` later.
//
// The PUT URL TTL is short (15 min) so a leaked link can't be reused
// hours later. The key is namespaced to the user so even if someone
// uploaded a file under another user's prefix they couldn't — the
// signature ties the URL to the exact key we generated.

const PresignSchema = z.object({
  contentType: z.string().min(1).max(80),
  sizeBytes: z.number().int().positive(),
});

const FinalizeSchema = z.object({
  key: z.string().min(1).max(300),
});

const PUT_URL_TTL_SECONDS = 15 * 60;

uploadsUserRoute.post(
  '/presign',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_UPLOAD, byClerkUserId),
  withCurrentUser(),
  zValidator('json', PresignSchema),
  async (c) => {
    const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID } = c.env;
    if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ACCOUNT_ID) {
      return c.json(
        {
          error: {
            code: 'presign_unconfigured',
            message:
              'R2 S3 credentials missing. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID.',
          },
        },
        503,
      );
    }

    const user = c.var.user;
    if (!user) {
      return c.json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } }, 401);
    }

    const { contentType, sizeBytes } = c.req.valid('json');

    // MIME and size validation match the multipart route exactly so
    // the two upload paths can't disagree on what's accepted.
    const isImage = USER_ALLOWED_IMAGE_MIME.has(contentType);
    const isVideo = USER_ALLOWED_VIDEO_MIME.has(contentType);
    if (!isImage && !isVideo) {
      const allowed = [...USER_ALLOWED_IMAGE_MIME, ...USER_ALLOWED_VIDEO_MIME].join(', ');
      return c.json(
        {
          error: {
            code: 'invalid_mime',
            message: `Unsupported file type "${contentType}". Allowed: ${allowed}.`,
          },
        },
        400,
      );
    }
    if (sizeBytes > USER_MAX_BYTES) {
      return c.json(
        {
          error: {
            code: 'file_too_large',
            message: `Max upload size is ${USER_MAX_BYTES / 1024 / 1024}MB.`,
          },
        },
        413,
      );
    }

    const ext = EXT_BY_MIME[contentType] ?? 'bin';
    const key = `user-uploads/${user.id}/${crypto.randomUUID()}.${ext}`;

    // aws4fetch signs the URL using SigV4 with empty body hash —
    // legal for PUT URLs and matches what Cloudflare expects for R2's
    // S3 endpoint. Region `auto` is the R2 convention.
    const client = new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    });

    const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const target = new URL(`${endpoint}/clickfy-uploads/${key}`);
    // Encode the TTL into the URL via X-Amz-Expires; aws4fetch threads
    // it into the signature so the URL is invalid after the window.
    target.searchParams.set('X-Amz-Expires', String(PUT_URL_TTL_SECONDS));

    const signed = await client.sign(
      new Request(target.toString(), {
        method: 'PUT',
        // The client must echo this exact Content-Type back when
        // doing the upload, otherwise SigV4 will reject the request.
        headers: { 'content-type': contentType },
      }),
      { aws: { signQuery: true } },
    );

    const expiresAt = new Date(Date.now() + PUT_URL_TTL_SECONDS * 1000).toISOString();

    return c.json({
      data: {
        uploadUrl: signed.url,
        key,
        contentType,
        expiresAt,
        // Echoed back so the client knows exactly which headers to
        // send on the PUT. Adding any other header — or omitting this
        // one — breaks the signature.
        headers: { 'content-type': contentType },
      },
    });
  },
);

uploadsUserRoute.post(
  '/finalize',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_UPLOAD, byClerkUserId),
  withCurrentUser(),
  zValidator('json', FinalizeSchema),
  async (c) => {
    const bucket = c.env.UPLOADS;
    if (!bucket) {
      return c.json(
        { error: { code: 'r2_not_configured', message: 'Uploads bucket binding missing.' } },
        503,
      );
    }

    const user = c.var.user;
    if (!user) {
      return c.json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } }, 401);
    }

    const { key } = c.req.valid('json');

    // Defense-in-depth: re-check that the key the client is asking us
    // to finalise actually belongs to them. The presigner already
    // generates the key, so under normal flow this is always true,
    // but defensive coding here means a compromised SDK can't
    // finalise an arbitrary key it didn't upload.
    const expectedPrefix = `user-uploads/${user.id}/`;
    if (!key.startsWith(expectedPrefix)) {
      return c.json(
        { error: { code: 'forbidden_key', message: 'Key does not belong to this user.' } },
        403,
      );
    }

    const head = await bucket.head(key);
    if (!head) {
      return c.json(
        {
          error: {
            code: 'object_not_uploaded',
            message: 'No object found at this key. Upload the file before calling finalize.',
          },
        },
        404,
      );
    }

    // ── Authoritative mime validation ────────────────────────────────
    //
    // The R2 PUT was made with a client-controlled `Content-Type`
    // header (the presigned URL only signs `host`, see the presign
    // route's note on aws4fetch + signQuery). So `head.httpMetadata
    // .contentType` reflects what the client *claimed* the file is,
    // not what the bytes actually are.
    //
    // Two checks below:
    //   (1) the stored content-type must be in our allow-list — no
    //       arbitrary mimes get through, even if R2 stored them;
    //   (2) the first 12 bytes (file signature) must match the
    //       stored content-type, so a malicious or buggy client can't
    //       upload arbitrary binary content claiming `image/jpeg` and
    //       have us pass it to an AI provider.
    //
    // On failure we delete the object — leaving rejected uploads in
    // the bucket would be a slow disk-fill vector.
    const storedMime = head.httpMetadata?.contentType?.toLowerCase() ?? null;
    const isAllowedImage = storedMime ? USER_ALLOWED_IMAGE_MIME.has(storedMime) : false;
    const isAllowedVideo = storedMime ? USER_ALLOWED_VIDEO_MIME.has(storedMime) : false;
    if (!isAllowedImage && !isAllowedVideo) {
      await bucket.delete(key).catch((err) => {
        console.warn('[uploads.finalize] cleanup of rejected key failed', { key, err });
      });
      const allowed = [...USER_ALLOWED_IMAGE_MIME, ...USER_ALLOWED_VIDEO_MIME].join(', ');
      return c.json(
        {
          error: {
            code: 'invalid_mime',
            message: `Uploaded object has an unsupported content-type (${storedMime ?? 'missing'}). Allowed: ${allowed}.`,
          },
        },
        400,
      );
    }

    // Range-GET the first 12 bytes for the signature check. We use a
    // ranged read rather than `bucket.get(key)` to avoid pulling the
    // full object — for a 10 MB upload that would cost ~50 ms and
    // ~10 MB of CPU-bound buffer allocation, while 12 bytes costs
    // ~5–10 ms total and zero meaningful memory.
    const sig = await bucket.get(key, { range: { offset: 0, length: 12 } });
    if (!sig) {
      // Race: the object was deleted between the HEAD above and this
      // GET. Either a duplicate finalize from the same client or a
      // bucket-lifecycle policy we don't know about. Either way the
      // object is no longer there.
      return c.json(
        {
          error: {
            code: 'object_disappeared',
            message: 'The uploaded object is no longer available. Re-upload and try again.',
          },
        },
        409,
      );
    }
    const signatureBytes = new Uint8Array(await sig.arrayBuffer());
    const detectedMime = detectMimeFromBytes(signatureBytes);

    if (!detectedMime || !mimesAgree(detectedMime, storedMime!)) {
      await bucket.delete(key).catch((err) => {
        console.warn('[uploads.finalize] cleanup of mime-mismatched key failed', { key, err });
      });
      return c.json(
        {
          error: {
            code: 'mime_mismatch',
            message: detectedMime
              ? `File contents (${detectedMime}) don't match the declared type (${storedMime}). Pick a different file.`
              : `File contents are not a recognised image or video. Pick a different file.`,
          },
        },
        400,
      );
    }

    const origin = new URL(c.req.url).origin;
    return c.json({
      data: {
        key,
        url: `${origin}/v1/uploads/${key}`,
        // Return the *detected* mime, not the stored one — they
        // agree by this point, but the detected value is the
        // ground truth and the one we want propagated downstream.
        contentType: detectedMime,
        sizeBytes: head.size,
      },
    });
  },
);
