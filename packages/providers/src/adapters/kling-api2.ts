/**
 * Kling **API 2.0** adapter.
 *
 * Kuaishou shipped a second-generation HTTP surface that shares almost
 * nothing with the one in `kling.ts`:
 *
 *   | | legacy (`kling.ts`)            | this file                      |
 *   |-|--------------------------------|--------------------------------|
 *   | host   | api.klingai.com          | api-singapore.klingai.com      |
 *   | model  | `model_name` body field  | a path segment                 |
 *   | inputs | `image` / `image_tail`   | `contents[]` of typed parts    |
 *   | tier   | `mode: std\|pro\|4k`     | `settings.resolution`          |
 *   | audio  | `sound: on\|off`         | `settings.audio`               |
 *   | poll   | per-variant poll URL     | unified `GET /tasks?task_ids=` |
 *   | auth   | JWT signed from AK/SK    | a console-issued API key       |
 *
 * The auth difference is hard: the new host rejects AK/SK outright with
 * `code 1002 — "The current API does not support AK/SK"`, so this
 * adapter takes an API key and the legacy one keeps its key pair. Both
 * are expected to be configured at once during the migration.
 *
 * Kling 3.0 Turbo and O1 exist ONLY here. The legacy endpoints still
 * work for the models that predate the split, so this runs alongside
 * `kling.ts` rather than replacing it in one step.
 *
 * Verified against the live API on 2026-08-15, without creating a single
 * billable task — each probe sent this adapter's exact body with one
 * deliberately invalid VALUE, so the server had to parse the whole
 * envelope before it could complain:
 *
 *   - auth with the console key                        → 200 SUCCEED
 *   - polling by system id is `?task_ids=`             (the service itself
 *     answers "task_ids or external_task_ids is required" otherwise)
 *   - `/text-to-video/kling-2.6` with a bare `prompt`  → rejects duration 7
 *   - `/omni-video/kling-3.0-omni` with `contents[]`
 *     carrying a `refer_image`                         → rejects duration 99
 *   - the server echoes the field path back, confirming each name:
 *     `settings.resolution value '9000p' is invalid`,
 *     `settings.audio value 'bogus' is invalid`,
 *     `settings.aspect_ratio value '7:3' is invalid`
 *   - a legacy `settings.mode` key is ignored, not rejected — so a stale
 *     field would fail silently rather than loudly. Do not rely on the
 *     server to catch one.
 *
 * Still unproven: a full successful generation, i.e. the output-parsing
 * path in `pollKlingApi2`. That one needs a real (billable) render.
 *
 * Docs: https://kling.ai/document-api/api/video/3-0-omni
 */

import type { ExecuteResult } from '../execute';
import type { ImagePart, KlingCompiledRequest } from '../compile-types';

export interface KlingApi2Env {
  /** Console-issued API key. NOT the legacy access/secret pair. */
  apiKey: string;
  /** Override for tests or other regional hosts. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api-singapore.klingai.com';

/**
 * Which endpoint family serves a compiled request. Mirrors the
 * `variant` the compiler already picks, so no new decision is made
 * here — only the URL spelling changed between API generations.
 */
const PATH_FOR_VARIANT: Record<KlingCompiledRequest['variant'], string> = {
  text2video: 'text-to-video',
  image2video: 'image-to-video',
  omni: 'omni-video',
};

/**
 * Legacy tier keys → API 2.0 resolutions.
 *
 * These are the same three rungs under different names, which is why
 * `provider_models.tier_pricing` keeps working untouched across the
 * migration: the key we bill on (`std`) and the value we send
 * (`720p`) are just two spellings of one choice.
 */
const RESOLUTION_FOR_MODE: Record<string, '720p' | '1080p' | '4k'> = {
  standard: '720p',
  std: '720p',
  pro: '1080p',
  '4k': '4k',
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * The `url` field on every image part accepts "URL or Base64". We
 * prefer a real URL — no payload bloat, no 50MB ceiling to worry
 * about — and fall back to a data URI so the MIME type travels with
 * the bytes.
 */
function imageSource(part: ImagePart): string {
  if (part.url) return part.url;
  if (!part.bytes) {
    throw new Error(
      `Kling API 2.0 adapter received an image part with no bytes and no URL (role=${part.role}). Hydrate the part from R2 first.`,
    );
  }
  return `data:${part.mimeType};base64,${bytesToBase64(part.bytes)}`;
}

type ContentPart =
  | { type: 'prompt'; text: string }
  | { type: 'first_frame' | 'last_frame' | 'refer_image'; url: string; id?: string };

interface TaskEnvelope {
  code: number;
  message?: string;
  request_id?: string;
  data?: unknown;
}

interface TaskRow {
  id?: string;
  status?: 'submitted' | 'processing' | 'succeeded' | 'failed';
  message?: string;
  outputs?: Array<{
    type?: string;
    url?: string;
    duration?: string | number;
  }>;
}

async function callKlingApi2(
  url: string,
  init: RequestInit,
  env: KlingApi2Env,
): Promise<TaskEnvelope> {
  if (!env.apiKey) {
    throw new Error('Kling API 2.0 adapter requires `env.apiKey`.');
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      Authorization: `Bearer ${env.apiKey}`,
    },
  });
  const text = await res.text();
  let json: TaskEnvelope;
  try {
    json = JSON.parse(text) as TaskEnvelope;
  } catch {
    throw new Error(`Kling API 2.0 ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  // 1002 is the specific failure mode of pointing legacy credentials at
  // this host; call it out rather than leaving a bare auth error.
  if (json.code === 1002) {
    throw new Error(
      `Kling API 2.0 rejected the credential (code 1002): ${json.message ?? 'authentication error'}. This host requires a console-issued API key, not the legacy access/secret pair.`,
    );
  }
  if (!res.ok || (typeof json.code === 'number' && json.code !== 0)) {
    throw new Error(
      `Kling API 2.0 error code=${json.code} message=${json.message ?? res.statusText}`,
    );
  }
  return json;
}

/** Build the `contents[]` array. Order follows the compiler's indices. */
function buildContents(request: KlingCompiledRequest): ContentPart[] {
  const contents: ContentPart[] = [{ type: 'prompt', text: request.prompt }];

  if (request.startImage) {
    contents.push({ type: 'first_frame', url: imageSource(request.startImage) });
  }
  if (request.endImage) {
    contents.push({ type: 'last_frame', url: imageSource(request.endImage) });
  }
  // Plain inline references. Only the omni endpoints accept these; the
  // compiler already refuses to populate `referenceImages` for models
  // whose capabilities say otherwise.
  for (const ref of request.referenceImages ?? []) {
    contents.push({
      type: 'refer_image',
      url: imageSource(ref),
      // `id` is what the prompt's `@image_N` token binds to.
      id: `image_${ref.index}`,
    });
  }
  return contents;
}

function buildSettings(request: KlingCompiledRequest): Record<string, unknown> {
  const settings: Record<string, unknown> = {};

  const resolution = request.mode ? RESOLUTION_FOR_MODE[request.mode] : undefined;
  if (resolution) settings.resolution = resolution;
  if (typeof request.duration === 'number') settings.duration = request.duration;

  // `aspect_ratio` is only meaningful when the frame size is not already
  // implied by a first frame. Kling documents it as REQUIRED on the omni
  // endpoints when there is neither a first frame nor a reference video.
  if (request.aspectRatio && !request.startImage) {
    settings.aspect_ratio = request.aspectRatio;
  }

  // Tri-state upstream (`native` / `original` / `off`). Which "on" value
  // is legal depends on the model: 2.6 / 3.0 / 3.0 Omni take `native`
  // ("audio matching the visuals"), O1 takes `original` ("retains the
  // original sound of the reference video") and rejects `native`. The
  // compiler copies the right one onto the request. Always explicit so
  // the server default cannot surprise us.
  settings.audio = request.soundEnabled ? (request.soundOnValue ?? 'native') : 'off';

  // Upstream defaults `multi_shot` to TRUE on the 3.0 family, so a
  // prompt that merely happens to contain semicolons can be parsed as a
  // multi-shot storyboard and come back as several cuts. Templates ask
  // for one continuous shot, so state it rather than inherit it.
  settings.multi_shot = false;

  return settings;
}

/**
 * Create a generation task. Always async on this API — the response
 * carries a task id and nothing else, so this returns `pending` and the
 * orchestrator polls.
 */
export async function executeKlingApi2(
  request: KlingCompiledRequest,
  env: KlingApi2Env,
): Promise<ExecuteResult> {
  const base = env.baseUrl ?? DEFAULT_BASE_URL;
  const kind = PATH_FOR_VARIANT[request.variant];
  const url = `${base}/${kind}/${request.model}`;

  // Text-to-video takes a bare `prompt` string; the other two take the
  // typed `contents[]` array. This asymmetry is Kling's, not ours.
  const body: Record<string, unknown> =
    request.variant === 'text2video'
      ? { prompt: request.prompt }
      : { contents: buildContents(request) };

  body.settings = buildSettings(request);
  body.options = { watermark_info: { enabled: false } };

  const json = await callKlingApi2(url, { method: 'POST', body: JSON.stringify(body) }, env);
  const data = json.data as { id?: string } | undefined;
  const taskId = data?.id;
  if (!taskId) {
    throw new Error(
      `Kling API 2.0 accepted the ${kind} request but returned no task id (request_id=${json.request_id ?? 'unknown'}).`,
    );
  }

  return { status: 'pending', taskId, provider: 'kling', variant: request.variant, api2: true };
}

/**
 * Poll a task. One endpoint serves every variant here, so unlike the
 * legacy adapter the variant is not needed to build the URL — it stays
 * in `ExecuteResult` only so in-flight legacy tasks keep resolving.
 */
export async function pollKlingApi2(
  taskId: string,
  env: KlingApi2Env,
): Promise<ExecuteResult> {
  const base = env.baseUrl ?? DEFAULT_BASE_URL;
  const json = await callKlingApi2(
    `${base}/tasks?task_ids=${encodeURIComponent(taskId)}`,
    { method: 'GET' },
    env,
  );

  const rows = (Array.isArray(json.data) ? json.data : []) as TaskRow[];
  const row = rows[0];
  // An unknown id comes back as an empty array rather than an error.
  // Treat it as still-pending: a task created moments ago can briefly
  // not be listed, and failing here would refund a job that is running.
  if (!row) {
    return { status: 'pending', taskId, provider: 'kling', variant: 'omni', api2: true };
  }

  if (row.status === 'failed') {
    throw new Error(
      `Kling task ${taskId} failed: ${row.message ?? 'no reason supplied'}`,
    );
  }
  if (row.status !== 'succeeded') {
    return { status: 'pending', taskId, provider: 'kling', variant: 'omni', api2: true };
  }

  const videos = (row.outputs ?? []).filter((o) => o.type === 'video' && o.url);
  if (videos.length === 0) {
    throw new Error(`Kling task ${taskId} succeeded but returned no video output.`);
  }

  return {
    status: 'completed',
    outputs: videos.map((v) => ({
      type: 'video' as const,
      url: v.url,
      durationSec: v.duration === undefined ? undefined : Number(v.duration),
    })),
  };
}
