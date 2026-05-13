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

/**
 * Fetch a user-uploaded object as raw bytes via
 * `GET /v1/uploads/<key>`. Public-read route — no auth header
 * needed (same posture as admin assets).
 */
export async function readUploadObject(r2Key: string): Promise<{
  bytes: Uint8Array;
  mimeType: string;
}> {
  const url = `${baseUrl()}/v1/uploads/${r2Key}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Worker read failed: GET ${url} -> ${res.status} ${res.statusText}`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type') ?? 'application/octet-stream';
  return { bytes, mimeType };
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
  const url = `${baseUrl()}/v1/outputs/internal/${r2Key}`;

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
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Worker write failed: PUT ${url} -> ${res.status} ${res.statusText} ${text.slice(0, 200)}`,
    );
  }
  return { r2Key };
}

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
    default:
      return 'bin';
  }
}
