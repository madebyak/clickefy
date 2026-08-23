/**
 * Seedance 2.0 adapter (BytePlus ModelArk).
 *
 * API surface (Singapore region):
 *
 *   Base   https://ark.ap-southeast.bytepluses.com/api/v3
 *   Auth   Authorization: Bearer <ARK_API_KEY>
 *
 *   Submit POST /contents/generations/tasks
 *          body: { model, content: [...], ratio, duration, resolution,
 *                  generate_audio, return_last_frame, camera_fixed, seed,
 *                  callback_url? }
 *          → 200 { id: "<task_id>" }
 *
 *   Poll   GET  /contents/generations/tasks/{id}
 *          → 200 { status: 'queued' | 'running' | 'succeeded' | 'failed',
 *                  content: { video_url, ...optional metadata } | null,
 *                  error?: { code, message } }
 *
 * The `content[]` array on submit interleaves prompt text with media:
 *
 *   [
 *     { type: 'text', text: '<final prompt>' },
 *     { type: 'image_url', image_url: { url }, role: 'first_frame' },
 *     { type: 'image_url', image_url: { url }, role: 'last_frame' },     // optional
 *     { type: 'image_url', image_url: { url }, role: 'reference_image' } // 0..n
 *     // (audio_url / video_url variants if assetKind != image)
 *   ]
 *
 * Image source preference:
 *   1. If `part.url` is set AND looks publicly reachable, use it
 *      directly (Seedance fetches from Singapore — saves bandwidth,
 *      stays under request size limits).
 *   2. Otherwise inline as `data:<mime>;base64,<bytes>` data URI.
 *
 * Localhost URLs (127.0.0.1, localhost) automatically fall back to
 * the base64 path because Seedance can't reach them. This is the
 * dev-time safety net so the same adapter works in `wrangler dev`.
 *
 * Async lifecycle: every Seedance call is async — submit returns a
 * task_id, poll on a ~3–5s cadence. The orchestrator handles this
 * through `pollAsyncTask()`; see `apps/jobs-worker/src/trigger/
 * generate-job.ts`.
 *
 * References:
 *   - https://docs.byteplus.com/en/docs/ModelArk
 *   - https://ark.ap-southeast.bytepluses.com/api/v3 (Singapore region)
 */

import type { ExecuteResult } from '../execute';
import type { ImagePart, SeedanceCompiledRequest } from '../compile-types';

export interface SeedanceEnv {
  /** Bearer token minted in the BytePlus console under "API Key Management". */
  apiKey: string;
  /** Override for tests or alternate regional endpoints. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

/**
 * URLs we never hand to Seedance because the server can't reach them
 * — falls back to base64 inlining instead. Anchored matches only so
 * a legitimate hostname like `not-localhost.example.com` doesn't
 * trip the filter.
 */
const UNREACHABLE_HOST_RE = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(?::|\/|$)/i;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Resolve an image part to a Seedance-acceptable `url` value.
 *
 * Preference order:
 *   1. Public URL when set AND not localhost/127.0.0.1.
 *   2. `data:<mime>;base64,<bytes>` data URI inlined from `bytes`.
 *
 * If neither is available the adapter throws — the caller is
 * responsible for hydrating the part (the input-resolver does this
 * before compile time).
 */
function imageForSeedance(part: ImagePart): string {
  if (part.url && !UNREACHABLE_HOST_RE.test(part.url)) return part.url;
  if (part.bytes) {
    return `data:${part.mimeType};base64,${bytesToBase64(part.bytes)}`;
  }
  throw new Error(
    `Seedance adapter received an image part with no URL and no bytes (role=${part.role}, index=${part.index}). Hydrate the part before compile time.`,
  );
}

/**
 * Decide which `type` (and key) to use on a Seedance content[] entry
 * based on the part's MIME type. Seedance accepts:
 *   - `image_url` with `image_url: { url }`
 *   - `video_url` with `video_url: { url }`
 *   - `audio_url` with `audio_url: { url }`
 *
 * The roles map onto each:
 *   - first_frame / last_frame / reference_image (for image_url)
 *   - reference_video                            (for video_url)
 *   - reference_audio                            (for audio_url)
 */
function mediaTypeForPart(part: ImagePart): 'image_url' | 'video_url' | 'audio_url' {
  const mime = (part.mimeType || '').toLowerCase();
  if (mime.startsWith('video/')) return 'video_url';
  if (mime.startsWith('audio/')) return 'audio_url';
  return 'image_url';
}

/**
 * Build one entry in Seedance's content[] array from an ImagePart
 * plus a role string. The role is structural — it tells the model
 * how to interpret this asset.
 */
function makeContentEntry(
  part: ImagePart,
  role: 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio',
): Record<string, unknown> {
  const type = mediaTypeForPart(part);
  const url = imageForSeedance(part);
  return {
    type,
    [type]: { url },
    role,
  };
}

/** Pick the correct reference-role keyword based on the part's media type. */
function referenceRoleFor(part: ImagePart): 'reference_image' | 'reference_video' | 'reference_audio' {
  const t = mediaTypeForPart(part);
  if (t === 'video_url') return 'reference_video';
  if (t === 'audio_url') return 'reference_audio';
  return 'reference_image';
}

/**
 * Build the full request body for POST /contents/generations/tasks.
 *
 * Order inside `content[]`:
 *   1. text prompt
 *   2. first_frame (if present)
 *   3. last_frame  (if present)
 *   4. reference_image / reference_video / reference_audio in
 *      compiler-declared order
 *
 * `ratio === 'adaptive'` is forwarded verbatim — Seedance interprets
 * it as "match the first image's aspect ratio" which is the right
 * behaviour for I2V flows.
 */
function buildBody(request: SeedanceCompiledRequest): Record<string, unknown> {
  const content: Record<string, unknown>[] = [
    { type: 'text', text: request.prompt },
  ];
  if (request.startImage) {
    content.push(makeContentEntry(request.startImage, 'first_frame'));
  }
  if (request.endImage) {
    content.push(makeContentEntry(request.endImage, 'last_frame'));
  }
  for (const ref of request.referenceImages ?? []) {
    content.push(makeContentEntry(ref, referenceRoleFor(ref)));
  }

  const body: Record<string, unknown> = {
    model: request.model,
    content,
  };
  if (request.ratio) body.ratio = request.ratio;
  if (typeof request.duration === 'number') body.duration = request.duration;
  if (request.resolution) body.resolution = request.resolution;
  // Seedance 2.5 only. Declaring the omni sub-task makes ModelArk check
  // the task-shape constraints synchronously, so a bad combination is a
  // 4xx here rather than an async failure on a queued, already-paid job.
  if (request.omniReferenceTaskType) {
    body.omni_reference_task_type = request.omniReferenceTaskType;
  }
  if (typeof request.generateAudio === 'boolean') {
    body.generate_audio = request.generateAudio;
  }
  if (typeof request.returnLastFrame === 'boolean') {
    body.return_last_frame = request.returnLastFrame;
  }
  if (typeof request.cameraFixed === 'boolean') {
    body.camera_fixed = request.cameraFixed;
  }
  if (typeof request.seed === 'number') body.seed = request.seed;
  if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
  return body;
}

interface SeedanceTaskResponse {
  id?: string;
  status?: 'queued' | 'running' | 'succeeded' | 'failed' | string;
  content?: {
    video_url?: string;
    duration?: number | string;
    last_frame_url?: string;
  } | null;
  error?: { code?: string; message?: string } | null;
  usage?: { completion_tokens?: number; total_tokens?: number };
}

async function callSeedance(
  url: string,
  init: RequestInit,
  env: SeedanceEnv,
): Promise<SeedanceTaskResponse> {
  if (!env.apiKey) {
    throw new Error('Seedance adapter requires `env.apiKey` (Bearer ARK_API_KEY).');
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${env.apiKey}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Seedance API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }
  return (await res.json()) as SeedanceTaskResponse;
}

/**
 * Submit a Seedance generation task. Returns `{ status: 'pending' }`
 * with the task_id; the caller polls via `pollSeedance()` until
 * `completed` or an error is thrown.
 */
export async function executeSeedance(
  request: SeedanceCompiledRequest,
  env: SeedanceEnv,
): Promise<ExecuteResult> {
  const baseUrl = (env.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const body = buildBody(request);

  const json = await callSeedance(
    `${baseUrl}/contents/generations/tasks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );

  const taskId = json.id;
  if (!taskId) {
    throw new Error(
      `Seedance submit response did not include a task id. Body: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return { status: 'pending', taskId, provider: 'seedance' };
}

/**
 * Poll a previously-submitted Seedance task. Returns `{ status: 'completed' }`
 * once the task has finished; `{ status: 'pending' }` while still in
 * `queued` / `running`. Throws on `failed`.
 */
export async function pollSeedance(
  taskId: string,
  env: SeedanceEnv,
): Promise<ExecuteResult> {
  const baseUrl = (env.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const json = await callSeedance(
    `${baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
    { method: 'GET' },
    env,
  );

  const status = json.status;
  if (status === 'succeeded') {
    const url = json.content?.video_url;
    if (!url) {
      throw new Error('Seedance task succeeded but content.video_url is missing.');
    }
    const dur = json.content?.duration;
    return {
      status: 'completed',
      outputs: [
        {
          type: 'video',
          url,
          mimeType: 'video/mp4',
          durationSec: typeof dur === 'string' ? Number(dur) : dur,
        },
      ],
    };
  }
  if (status === 'failed') {
    const code = json.error?.code ?? 'unknown';
    const message = json.error?.message ?? 'Seedance task failed with no error detail.';
    throw new Error(`Seedance task failed (${code}): ${message}`);
  }
  // queued | running | unknown — keep polling.
  return { status: 'pending', taskId, provider: 'seedance' };
}
