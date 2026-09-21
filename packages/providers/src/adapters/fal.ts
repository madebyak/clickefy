/**
 * fal.ai — the aggregator adapter.
 *
 * WHY ONE ADAPTER COVERS MANY MODELS
 *   fal hosts hundreds of models behind ONE queue protocol: every model
 *   is submitted, polled and collected identically, and only the JSON
 *   body differs. So this file knows the protocol and nothing else; what
 *   each model wants in its body is decided in `compile.ts`, the same way
 *   every other provider works here. Adding a second fal model should be
 *   a capability entry and a compile branch, never a change in here.
 *
 * THE PROTOCOL
 *   POST   https://queue.fal.run/{endpoint}                  -> request_id
 *   GET    https://queue.fal.run/{endpoint}/requests/{id}/status
 *   GET    https://queue.fal.run/{endpoint}/requests/{id}
 *   PUT    https://queue.fal.run/{endpoint}/requests/{id}/cancel
 *
 *   Auth is `Authorization: Key <FAL_KEY>` — not `Bearer`, which fails
 *   with a 401 that reads like a bad key rather than a bad scheme.
 *
 * POLLING TAKES A WHILE
 *   Measured on the ByteDance upscaler: a 10-second clip to 1080p spent
 *   242 seconds in inference — roughly 24x realtime. fal bills the VIDEO
 *   seconds rather than that compute time (verified against a real
 *   invoice line: 10.00 seconds x $0.0072), so the cost is predictable
 *   even though the wait is not. Callers must budget minutes, not
 *   seconds, and must not hold a request open while they wait.
 */

export interface FalEnv {
  /** From fal.ai/dashboard/keys. */
  apiKey: string;
  /** Overridable for tests. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://queue.fal.run';

/** What `compile.ts` produces for a fal model. */
export interface FalCompiledRequest {
  provider: 'fal';
  /** The fal endpoint id, e.g. `fal-ai/bytedance-upscaler/upscale/video`. */
  endpoint: string;
  /**
   * The model's own input body, already shaped by the compiler.
   *
   * Deliberately opaque here: every fal model has a different schema
   * (published at `fal.ai/api/openapi/queue/openapi.json?endpoint_id=…`),
   * and teaching this adapter about each one would make it the exact
   * bottleneck the aggregator is supposed to remove.
   */
  input: Record<string, unknown>;
}

export interface FalSubmitResult {
  status: 'pending';
  taskId: string;
  provider: 'fal';
  /** Carried forward: the poll URL is per-endpoint, not global. */
  endpoint: string;
}

export interface FalOutput {
  type: 'image' | 'video';
  url: string;
  durationSec?: number;
}

function headers(env: FalEnv): Record<string, string> {
  return {
    // `Key`, not `Bearer`.
    Authorization: `Key ${env.apiKey}`,
    'Content-Type': 'application/json',
  };
}

/** Strip the trailing path segments fal's own status URLs already carry. */
function queueUrl(env: FalEnv, endpoint: string, suffix = ''): string {
  const base = (env.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  return `${base}/${endpoint}${suffix}`;
}

/**
 * The id fal wants when polling is the endpoint's OWNER path, not the
 * full endpoint.
 *
 * Submitting to `fal-ai/bytedance-upscaler/upscale/video` returns status
 * URLs under `fal-ai/bytedance-upscaler/requests/{id}` — the trailing
 * `/upscale/video` is dropped. Deriving it rather than storing fal's
 * returned URL keeps the persisted task portable, and the rule is
 * simple: the first two segments.
 */
export function pollBase(endpoint: string): string {
  const parts = endpoint.split('/').filter(Boolean);
  return parts.slice(0, 2).join('/');
}

async function falFetch(url: string, env: FalEnv, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { ...headers(env), ...init?.headers } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`fal ${res.status} ${url.replace(/\/[0-9a-f-]{20,}/i, '/<id>')}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`fal returned non-JSON from ${url}: ${text.slice(0, 200)}`);
  }
}

/** Submit a job. Always async — fal queues everything. */
export async function executeFal(
  request: FalCompiledRequest,
  env: FalEnv,
): Promise<FalSubmitResult> {
  const body = await falFetch(queueUrl(env, request.endpoint), env, {
    method: 'POST',
    body: JSON.stringify(request.input),
  });
  const requestId = (body as { request_id?: string }).request_id;
  if (!requestId) {
    throw new Error(`fal accepted the request but returned no request_id: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return { status: 'pending', taskId: requestId, provider: 'fal', endpoint: request.endpoint };
}

export type FalPollResult =
  | { status: 'pending' }
  | { status: 'completed'; outputs: FalOutput[] }
  | { status: 'failed'; error: string };

/**
 * Check a queued job, and collect it when it is done.
 *
 * fal reports `IN_QUEUE`, `IN_PROGRESS` or `COMPLETED`. A failure is NOT
 * a fourth status — it arrives as a non-2xx on the result fetch, or as an
 * `error` field in the payload, so both are treated as terminal here
 * rather than being retried forever by the caller.
 */
export async function pollFal(
  taskId: string,
  endpoint: string,
  env: FalEnv,
): Promise<FalPollResult> {
  const base = pollBase(endpoint);
  const status = (await falFetch(
    queueUrl(env, base, `/requests/${taskId}/status`),
    env,
  )) as { status?: string };

  if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') {
    return { status: 'pending' };
  }
  if (status.status !== 'COMPLETED') {
    return { status: 'failed', error: `fal returned an unexpected status: ${status.status ?? 'none'}` };
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await falFetch(queueUrl(env, base, `/requests/${taskId}`), env)) as Record<string, unknown>;
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
  if (payload.error) {
    return { status: 'failed', error: JSON.stringify(payload.error).slice(0, 300) };
  }

  const outputs = collectOutputs(payload);
  if (outputs.length === 0) {
    return {
      status: 'failed',
      error: `fal completed but returned no media: ${JSON.stringify(payload).slice(0, 200)}`,
    };
  }
  return { status: 'completed', outputs };
}

/**
 * Pull media out of a result payload.
 *
 * Every fal model returns its own shape — `{video: {url}}`, `{image: …}`,
 * `{images: [...]}`, `{audio: …}` — but they all bottom out in an object
 * with a `url`. Rather than a per-model extractor (which would put every
 * model back in this file), this walks the payload and takes what looks
 * like media, deciding type from the declared content type or the file
 * extension.
 */
function collectOutputs(payload: unknown): FalOutput[] {
  const found: FalOutput[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const url = typeof obj.url === 'string' ? obj.url : null;
    if (url && !seen.has(url)) {
      const contentType = typeof obj.content_type === 'string' ? obj.content_type : '';
      const isVideo =
        contentType.startsWith('video/') || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
      const isImage =
        contentType.startsWith('image/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
      if (isVideo || isImage) {
        seen.add(url);
        found.push({
          type: isVideo ? 'video' : 'image',
          url,
          ...(typeof obj.duration === 'number' ? { durationSec: obj.duration } : {}),
        });
      }
    }
    for (const value of Object.values(obj)) visit(value);
  };

  visit(payload);
  return found;
}

/** Best-effort cancel. A job already finished is not an error worth raising. */
export async function cancelFal(taskId: string, endpoint: string, env: FalEnv): Promise<boolean> {
  try {
    await falFetch(queueUrl(env, pollBase(endpoint), `/requests/${taskId}/cancel`), env, {
      method: 'PUT',
    });
    return true;
  } catch {
    return false;
  }
}
