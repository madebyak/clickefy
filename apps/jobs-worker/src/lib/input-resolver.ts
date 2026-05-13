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

import { readUploadObject } from './r2';

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
      const obj = await readUploadObject(val.r2Key);
      return [
        fieldKey,
        {
          kind: val.kind,
          r2Key: val.r2Key,
          mimeType: obj.mimeType || val.mimeType,
          bytes: obj.bytes,
        },
      ];
    }),
  );
  return Object.fromEntries(entries);
}
