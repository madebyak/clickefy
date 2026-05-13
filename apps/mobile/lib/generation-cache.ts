/**
 * Lightweight module-scoped cache for generation outputs.
 *
 * The generating screen writes outputs here on completion, and the
 * result screen reads them by jobId. This avoids passing potentially
 * large arrays of CDN URLs through URL params, which can exceed
 * platform URL length limits (~2000 chars) and get silently
 * truncated.
 *
 * Outputs are kind-tagged so the result screen knows whether to
 * render <Image> or <Video> per slot.
 */

import type { JobOutput } from '@clickfy/sdk';

const cache = new Map<string, JobOutput[]>();

export function setGenerationOutputs(jobId: string, outputs: JobOutput[]) {
  cache.set(jobId, outputs);
}

export function getGenerationOutputs(jobId: string): JobOutput[] | undefined {
  return cache.get(jobId);
}

export function clearGenerationOutputs(jobId: string) {
  cache.delete(jobId);
}
