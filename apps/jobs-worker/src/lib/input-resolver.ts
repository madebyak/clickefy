/**
 * `resolveJobInputs()` — convert the persisted `jobs.inputs` JSONB
 * (a discriminated union of text / image / video `JobInputValue`)
 * into the `RuntimeInputValue` shape the prompt compiler expects.
 *
 * Image / video inputs need their bytes pulled from R2 because the
 * Gemini adapter inlines them as base64 in the request. Kling's
 * image2video accepts URLs, but we still want the bytes locally so
 * we can compute a content hash / size for logging and so the
 * compiler doesn't need to know about provider-specific addressing
 * (everything downstream stays uniform).
 *
 * Reads run in parallel because the input set is usually 1–3 items
 * and we want the slowest single read to bound stage start-up, not
 * the sum of all reads.
 */

import type { JobInputValue } from '@clickfy/types';
import type { RuntimeInputValue } from '@clickfy/providers';

import { env } from '../env';
import { logger } from '@trigger.dev/sdk';

import { readUploadObject, UploadMissingError } from './r2';

/**
 * Build the public URL the provider adapters can hand to URL-fetching
 * providers (Kling image2video, Seedance content[]). All user-uploaded
 * assets live behind the Worker's public proxy at
 * `${WORKER_API_URL}/v1/uploads/<key>`.
 *
 * Providers that prefer URLs over base64 (Kling, Seedance) save us a
 * big chunk of request body — a 720p reference image at 4MB base64-
 * encodes to ~5.5MB on the wire vs ~30 bytes for the URL. URL-mode
 * also keeps us under per-request size ceilings.
 *
 * Adapters always fall back to the bytes when the URL isn't reachable
 * (local dev `127.0.0.1` won't resolve from a Seedance server in
 * Singapore — the adapter detects this and inlines base64 anyway).
 */
function publicUrlForR2(r2Key: string): string {
  return `${env.WORKER_API_URL.replace(/\/$/, '')}/v1/uploads/${r2Key}`;
}

/** Downloads at a time. Twelve in parallel on one shared uplink starved each other past their timeouts (2026-10-29). */
const READ_CONCURRENCY = 4;

/** An attachment could not be downloaded after every retry; the upload itself exists. Distinct from a missing one. */
export class InputDownloadError extends Error {
  override name = 'InputDownloadError';
  constructor(message: string, readonly r2Key: string) {
    super(message);
  }
}

export async function resolveJobInputs(
  inputs: Record<string, JobInputValue>,
): Promise<Record<string, RuntimeInputValue>> {
  const started = Date.now();
  const entries = Object.entries(inputs);
  const out: Array<[string, RuntimeInputValue]> = new Array(entries.length);
  const timings: Array<{ key: string; ms: number; bytes: number }> = [];
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      const [fieldKey, val] = entries[i]!;
      if (val.kind === 'text') {
        out[i] = [fieldKey, { kind: 'text', value: val.value }];
        continue;
      }
      const t0 = Date.now();
      let obj: Awaited<ReturnType<typeof readUploadObject>>;
      try {
        obj = await readUploadObject(val.r2Key, { sizeBytes: (val as { sizeBytes?: number }).sizeBytes ?? null });
      } catch (err) {
        if (err instanceof UploadMissingError) throw err;
        throw new InputDownloadError(`${val.r2Key}: ${String(err)}`, val.r2Key);
      }
      timings.push({ key: val.r2Key, ms: Date.now() - t0, bytes: obj.bytes.byteLength });
      out[i] = [
        fieldKey,
        {
          kind: val.kind,
          r2Key: val.r2Key,
          mimeType: obj.mimeType || val.mimeType,
          bytes: obj.bytes,
          url: publicUrlForR2(val.r2Key),
        },
      ];
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, entries.length) }, worker));
  if (timings.length > 0) {
    const slowest = timings.reduce((a, b) => (b.ms > a.ms ? b : a));
    logger.info('inputs:resolved', {
      files: timings.length,
      totalMb: Math.round(timings.reduce((n, t) => n + t.bytes, 0) / 104_857.6) / 10,
      totalMs: Date.now() - started,
      slowestMs: slowest.ms,
      slowestKey: slowest.key,
    });
  }
  return Object.fromEntries(out);
}
