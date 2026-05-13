/**
 * Kling adapter — supports two endpoint shapes:
 *
 *   - `image2video` (v2 family): single subject image, optional end
 *     frame, prompt without image references. POST → `/v1/videos/image2video`.
 *
 *   - `omni` (Kling V3 Omni): unified multimodal route. Carries an
 *     `image_list[]` of refs + first/end frames, with the prompt
 *     addressing them via `<<<image_N>>>` notation. POST →
 *     `/v1/videos/omni-video`.
 *
 * Both are async — submit returns a `task_id` we poll until
 * `succeed` | `failed`. JWT signing uses Web Crypto so the same code
 * runs in Cloudflare Workers and Node-based runtimes (Next.js admin
 * route, Trigger.dev tasks).
 *
 * References:
 *   - https://docs.anyfast.ai/guides/model-api/kuaishou/kling-v3-omni
 *   - https://thankyouai.com/developer/docs/kling-compat/omni-video
 */

import { signJwtHs256 } from '../runtime/jwt';
import type { ExecuteResult } from '../execute';
import type { ImagePart, KlingCompiledRequest } from '../compile-types';

export interface KlingEnv {
  accessKey: string;
  secretKey: string;
  /** Override for tests or regional endpoints. */
  baseUrl?: string;
}

/** Which Kling endpoint owns a given task — drives the poll URL. */
export type KlingPollVariant = 'image2video' | 'omni';

const DEFAULT_BASE_URL = 'https://api.klingai.com';

/**
 * Kling's JWT is short-lived — 30 minutes is the documented ceiling.
 * We mint fresh for every request; cost is negligible.
 */
async function mintToken(env: KlingEnv): Promise<string> {
  if (!env.accessKey || !env.secretKey) {
    throw new Error('Kling adapter requires `env.accessKey` and `env.secretKey`.');
  }
  const now = Math.floor(Date.now() / 1000);
  return signJwtHs256(
    {
      iss: env.accessKey,
      exp: now + 1800,
      nbf: now - 5,
      iat: now,
    },
    env.secretKey,
  );
}

/**
 * Encode an `ImagePart`'s bytes to a raw base64 string (no
 * `data:<mime>;base64,` prefix). Helper shared by the two payload
 * builders below; each one wraps the result in the format its
 * endpoint actually accepts.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Image format expected by Kling's **v2 `image2video`** endpoint
 * (`/v1/videos/image2video`).
 *
 * Kling's docs are explicit here: the `image` (and `image_tail`)
 * fields accept EITHER an HTTPS URL OR a raw base64 string — and
 * specifically NOT a `data:<mime>;base64,…` URI. Sending a data URI
 * comes back as
 *
 *     {"code":1201,"message":"File is not in a valid base64 format"}
 *
 * which is the same 1201 error we surfaced to the admin playground
 * before this fix.
 *
 * We prefer URLs when present (no payload bloat, no size limits);
 * otherwise we inline bytes as raw base64.
 */
function imageForImage2Video(part: ImagePart): string {
  if (part.url) return part.url;
  if (!part.bytes) {
    throw new Error(
      `Kling adapter received an image part with no bytes and no URL (role=${part.role}). Hydrate the part from R2 first.`,
    );
  }
  return bytesToBase64(part.bytes);
}

/**
 * Image format expected by Kling's **v3 Omni** endpoint
 * (`/v1/videos/omni-video`). Omni's `image_url` field is more
 * forgiving than v2's `image` — it accepts a public URL, a raw base64
 * string, OR a full `data:<mime>;base64,…` URI. We use the data-URI
 * form when inlining bytes so the MIME type is unambiguous on the
 * server side.
 */
function imageForOmni(part: ImagePart): string {
  if (part.url) return part.url;
  if (!part.bytes) {
    throw new Error(
      `Kling adapter received an image part with no bytes and no URL (role=${part.role}). Hydrate the part from R2 first.`,
    );
  }
  return `data:${part.mimeType};base64,${bytesToBase64(part.bytes)}`;
}

interface KlingApiResponse {
  code: number;
  message: string;
  data?: {
    task_id?: string;
    task_status?: string;
    task_result?: {
      videos?: { url?: string; duration?: number | string }[];
    };
  };
}

async function callKling(
  url: string,
  init: RequestInit,
  env: KlingEnv,
): Promise<KlingApiResponse> {
  const token = await mintToken(env);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kling API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as KlingApiResponse;
  if (json.code !== 0) {
    throw new Error(`Kling API error code=${json.code} message=${json.message ?? 'unknown'}`);
  }
  return json;
}

/**
 * Map a `KlingCompiledRequest` (Omni variant) onto the native Omni
 * payload. The compiler has already assigned 1-based `index` values
 * to every ImagePart in the exact order the model will see them —
 * subjects first (`first_frame`, optional `end_frame`), then plain
 * references — so we just iterate and tag each entry.
 */
function buildOmniBody(request: KlingCompiledRequest): Record<string, unknown> {
  const imageList: { image_url: string; type?: 'first_frame' | 'end_frame' }[] = [];
  if (request.startImage) {
    imageList.push({
      image_url: imageForOmni(request.startImage),
      type: 'first_frame',
    });
  }
  if (request.endImage) {
    imageList.push({
      image_url: imageForOmni(request.endImage),
      type: 'end_frame',
    });
  }
  for (const ref of request.referenceImages ?? []) {
    imageList.push({ image_url: imageForOmni(ref) });
  }

  // Omni's `mode` enum is `std | pro | 4k`. The compiler lets `standard`
  // through for v2 parity, so we normalise here.
  let mode: 'std' | 'pro' | '4k' | undefined;
  if (request.mode === 'standard' || request.mode === 'std') mode = 'std';
  else if (request.mode === 'pro') mode = 'pro';
  // 4k is not yet a documented value from the compiler; opt-in via raw config.

  const body: Record<string, unknown> = {
    model_name: request.model,
    prompt: request.prompt,
    mode: mode ?? 'pro',
    // Omni expects duration as a string per the docs.
    duration: String(request.duration ?? 5),
  };
  if (request.aspectRatio) body.aspect_ratio = request.aspectRatio;
  if (imageList.length > 0) body.image_list = imageList;
  if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
  return body;
}

function buildImage2VideoBody(request: KlingCompiledRequest): Record<string, unknown> {
  if (!request.startImage) {
    throw new Error(
      'Kling v2 requires a subject image. Add an image input field to the template or chain from a prior image stage.',
    );
  }
  const body: Record<string, unknown> = {
    model_name: request.model,
    mode: request.mode ?? 'std',
    image: imageForImage2Video(request.startImage),
    prompt: request.prompt,
    cfg_scale: request.cfgScale ?? 0.5,
    duration: request.duration ?? 5,
  };
  // `aspect_ratio` is only honored by v2.6+; v2-master and v2.5-turbo
  // silently lock to the input image's aspect. The compiler omits the
  // field for unsupported models — never default-fill here or we'd
  // re-introduce the "I picked 3:4, got square" bug from a different
  // direction.
  if (request.aspectRatio) body.aspect_ratio = request.aspectRatio;
  if (request.endImage) body.image_tail = imageForImage2Video(request.endImage);
  if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
  return body;
}

/**
 * Fire-and-poll: submit the task, return a `pending` result. The
 * caller polls via `pollKling()` until `completed` or `failed`. The
 * playground does this synchronously in a loop (~5s polls); a real
 * job pipeline (Trigger.dev) parks the run between polls instead.
 */
export async function executeKling(
  request: KlingCompiledRequest,
  env: KlingEnv,
): Promise<ExecuteResult> {
  const baseUrl = env.baseUrl ?? DEFAULT_BASE_URL;
  const variant: KlingPollVariant = request.variant === 'omni' ? 'omni' : 'image2video';
  const path =
    variant === 'omni' ? '/v1/videos/omni-video' : '/v1/videos/image2video';
  const body = variant === 'omni' ? buildOmniBody(request) : buildImage2VideoBody(request);

  const json = await callKling(
    `${baseUrl}${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );

  const taskId = json.data?.task_id;
  if (!taskId) {
    throw new Error('Kling response did not include a task_id.');
  }
  return { status: 'pending', taskId, provider: 'kling', variant };
}

/**
 * Poll a previously-submitted Kling task. The playground calls this
 * on a ~5s interval; a Trigger.dev task should rely on the same
 * helper but use the platform's wait-for-event facility instead of
 * a sleep loop. The `variant` arg picks the right detail endpoint.
 */
export async function pollKling(
  taskId: string,
  variant: KlingPollVariant,
  env: KlingEnv,
): Promise<ExecuteResult> {
  const baseUrl = env.baseUrl ?? DEFAULT_BASE_URL;
  const path =
    variant === 'omni'
      ? `/v1/videos/omni-video/${taskId}`
      : `/v1/videos/image2video/${taskId}`;
  const json = await callKling(`${baseUrl}${path}`, { method: 'GET' }, env);
  const status = json.data?.task_status;
  if (status === 'succeed') {
    const videos = json.data?.task_result?.videos ?? [];
    return {
      status: 'completed',
      outputs: videos
        .filter((v): v is { url: string; duration?: number | string } => Boolean(v.url))
        .map((v) => ({
          type: 'video',
          url: v.url,
          durationSec: typeof v.duration === 'string' ? Number(v.duration) : v.duration,
        })),
    };
  }
  if (status === 'failed') {
    throw new Error('Kling reported task_status=failed.');
  }
  return { status: 'pending', taskId, provider: 'kling', variant };
}
