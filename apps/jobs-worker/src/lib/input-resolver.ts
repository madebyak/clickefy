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
import { readUploadObject } from './r2';

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

export async function resolveJobInputs(
  inputs: Record<string, JobInputValue>,
): Promise<Record<string, RuntimeInputValue>> {
  const entries = await Promise.all(
    Object.entries(inputs).map(async ([fieldKey, val]): Promise<[string, RuntimeInputValue]> => {
      if (val.kind === 'text') {
        return [fieldKey, { kind: 'text', value: val.value }];
      }

      // Pull the user upload from R2. We re-read the mime type from
      // the object itself rather than trusting the submitted value
      // because R2 is the source of truth (the upload route also
      // wrote ContentType at PUT time).
      //
      // We populate BOTH `bytes` (Gemini inlines base64) and `url`
      // (Kling/Seedance prefer fetching from URL). Adapters pick the
      // form they need; no harm carrying both.
      const obj = await readUploadObject(val.r2Key);
      return [
        fieldKey,
        {
          kind: val.kind,
          r2Key: val.r2Key,
          mimeType: obj.mimeType || val.mimeType,
          bytes: obj.bytes,
          url: publicUrlForR2(val.r2Key),
        },
      ];
    }),
  );
  return Object.fromEntries(entries);
}
