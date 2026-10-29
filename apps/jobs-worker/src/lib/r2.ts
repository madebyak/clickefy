/**
 * R2 helpers — read user inputs, write generated outputs.
 *
 * Both operations go through the Worker's HTTP API rather than
 * directly to R2. Why:
 *
 *   1. ONE place owns the R2 binding (the Worker), so the
 *      cloud-vs-local-Miniflare split is invisible to this process.
 *   2. No R2 S3 credentials live in jobs-worker at all. Smaller
 *      blast radius, simpler ops (one credential set in the Worker
 *      covers everything).
 *   3. Local dev and production share the exact same code path.
 *      In dev the URL is 127.0.0.1; in prod it's the deployed
 *      Worker hostname.
 *
 * Key conventions (mirror the rest of the codebase):
 *
 *   - User inputs:   user-uploads/<userId>/<uuid>.<ext>
 *   - Outputs:       jobs/<jobId>/stage<N>-<idx>.<ext>
 */

import { env } from '../env';

/** The upload is gone (a real 404): final, never retried. */
export class UploadMissingError extends Error {
  override name = 'UploadMissingError';
}

/**
 * Fetch a user-uploaded object as raw bytes via
 * `GET /v1/uploads/<key>`. Public-read route — no auth header
 * needed (same posture as admin assets).
 *
 * Bounded and retried. Node's default is a 5-minute headers timeout
 * with no retry, which on 2026-10-04 turned a transient proxy stall
 * into 30 refunded jobs that reported "upload not found". The budget
 * scales with the file: on 2026-10-29, during a Cloudflare degradation,
 * twelve 4–7 MB attachments read in parallel under a flat 60 s each
 * failed nine jobs in a row. A 404 is final; everything else (timeout,
 * reset, 5xx) retries with backoff.
 */
export async function readUploadObject(
  r2Key: string,
  opts: { sizeBytes?: number | null } = {},
): Promise<{
  bytes: Uint8Array;
  mimeType: string;
}> {
  const url = `${baseUrl()}/v1/uploads/${r2Key}`;
  const timeoutMs = readTimeoutFor(opts.sizeBytes ?? null);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) {
        throw new UploadMissingError(`Worker read failed: GET ${url} -> 404 Not Found`);
      }
      if (!res.ok) {
        throw new RetryableReadError(`Worker read failed: GET ${url} -> ${res.status} ${res.statusText}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const mimeType = res.headers.get('content-type') ?? 'application/octet-stream';
      return { bytes, mimeType };
    } catch (err) {
      lastErr = err;
      if (err instanceof UploadMissingError) throw err;
      if (attempt < READ_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 2_000));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const READ_ATTEMPTS = 4;
const READ_TIMEOUT_BASE_MS = 60_000;
/** Extra budget per megabyte: a shared egress during a burst can drop under 100 KB/s. */
const READ_TIMEOUT_PER_MB_MS = 15_000;
const READ_TIMEOUT_MAX_MS = 5 * 60_000;
class RetryableReadError extends Error {}

function readTimeoutFor(sizeBytes: number | null): number {
  if (!sizeBytes || sizeBytes <= 0) return READ_TIMEOUT_BASE_MS;
  return Math.min(READ_TIMEOUT_MAX_MS, READ_TIMEOUT_BASE_MS + Math.ceil(sizeBytes / 1_048_576) * READ_TIMEOUT_PER_MB_MS);
}

/**
 * Persist a generated artifact via the Worker's internal route
 * (`PUT /v1/outputs/internal/<key>` + shared-secret header). The
 * Worker writes through its own R2 binding so we don't need any
 * S3 credentials here.
 */
export async function writeOutputObject(args: {
  jobId: string;
  stageIndex: number;
  outputIndex: number;
  bytes: Uint8Array | Buffer;
  mimeType: string;
}): Promise<{ r2Key: string }> {
  const ext = extensionForMime(args.mimeType);
  const r2Key = `jobs/${args.jobId}/stage${args.stageIndex}-${args.outputIndex}.${ext}`;
  await writeOutputBytes({ r2Key, bytes: args.bytes, mimeType: args.mimeType });
  return { r2Key };
}

/**
 * Write bytes to an explicit key in the OUTPUTS bucket. The generation
 * path names its keys through `writeOutputObject`; renditions (poster,
 * preview clip) sit next to their original under a derived key, so they
 * come through here directly.
 */
export async function writeOutputBytes(args: {
  r2Key: string;
  bytes: Uint8Array | Buffer;
  mimeType: string;
}): Promise<void> {
  const url = `${baseUrl()}/v1/outputs/internal/${args.r2Key}`;

  // Retried: this write comes AFTER the provider has finished, so a
  // single failed PUT throws away minutes of paid generation and the
  // run's retry generates it all over again (2026-10-29, during a
  // Cloudflare degradation: "put: Unspecified error (0)" and "fetch
  // failed" cost two Seedance renders). Network errors, 5xx and 429
  // retry with backoff; any other 4xx is a bug and surfaces at once.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    try {
      // Node's fetch accepts a Uint8Array / Buffer as body directly,
      // streaming under the hood. We pass it raw rather than wrapping
      // in a Blob to keep memory pressure low for large images.
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'content-type': args.mimeType,
          'x-internal-secret': env.INTERNAL_API_SECRET,
        },
        // Node's fetch BodyInit accepts Uint8Array natively, but TS's
        // built-in DOM-style typings disagree. Cast through unknown to
        // match the runtime contract without a `dom.iterable` import.
        body: args.bytes as unknown as ArrayBuffer,
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      });
      if (res.ok) return;
      const text = await res.text().catch(() => '');
      const message = `Worker write failed: PUT ${url} -> ${res.status} ${res.statusText} ${text.slice(0, 200)}`;
      if (res.status < 500 && res.status !== 429) throw new Error(message);
      lastErr = new Error(message);
    } catch (err) {
      if (err instanceof Error && /-> 4(?!29)\d\d /.test(err.message)) throw err;
      lastErr = err;
    }
    if (attempt < WRITE_ATTEMPTS) await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * 2 ** (attempt - 1))));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const WRITE_ATTEMPTS = 5;
/** A 100 MB clip at a slow shared uplink; well under the task's budget. */
const WRITE_TIMEOUT_MS = 3 * 60_000;

function baseUrl(): string {
  return env.WORKER_API_URL.replace(/\/$/, '');
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    case 'video/quicktime':
      return 'mov';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    default:
      return 'bin';
  }
}
