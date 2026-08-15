/**
 * OpenAI adapter — GPT Image 2.
 *
 * Synchronous like Gemini: one request, images returned inline, no task
 * to poll. Two endpoints depending on whether the stage has reference
 * images:
 *
 *   image-generate → POST /v1/images/generations   (JSON)
 *   image-edit     → POST /v1/images/edits         (multipart/form-data)
 *
 * The edit path is the only multipart call anywhere in this package. It
 * is built with the runtime's own `FormData`/`File`, which both the
 * Cloudflare Workers runtime and Node 18+ provide, and the boundary
 * header is deliberately NOT set — `fetch` derives it, and overriding it
 * corrupts the body.
 *
 * Model quirks, all verified against the live API on 2026-08-15:
 *   - Output is ALWAYS base64. `response_format` is ignored, so we never
 *     send it and never look for a URL.
 *   - `background: "transparent"` is rejected by this model.
 *   - `input_fidelity` is rejected outright; the model always runs inputs
 *     at high fidelity.
 *   - Refusals come back as `moderation_blocked`, which is terminal —
 *     retrying burns quota and will fail again.
 */

import type { GptImageCompiledRequest, ImagePart } from '../compile-types';

export interface OpenAIEnv {
  apiKey: string;
  /** Override for a proxy or a gateway; defaults to the public API. */
  baseUrl?: string;
  /** Optional org / project scoping headers. */
  organization?: string;
  project?: string;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface OpenAIImage {
  b64_json?: string;
  url?: string;
}

interface OpenAIResponse {
  data?: OpenAIImage[];
  output_format?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  error?: {
    code?: string;
    type?: string;
    message?: string;
    moderation_details?: { moderation_stage?: string; categories?: string[] };
  };
}

export interface OpenAIResult {
  status: 'completed';
  outputs: Array<{ type: 'image'; base64: string; mimeType: string }>;
}

function authHeaders(env: OpenAIEnv): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${env.apiKey}` };
  if (env.organization) headers['OpenAI-Organization'] = env.organization;
  if (env.project) headers['OpenAI-Project'] = env.project;
  return headers;
}

/** Reference images must be real file parts; base64 strings are not accepted. */
function toFilePart(part: ImagePart, i: number): File {
  if (!part.bytes) {
    throw new Error(
      `OpenAI adapter received image part ${i + 1} with no bytes (role=${part.role}). Hydrate the part before compile time.`,
    );
  }
  const ext = part.mimeType === 'image/jpeg' ? 'jpg' : part.mimeType === 'image/webp' ? 'webp' : 'png';
  // Copy into a fresh ArrayBuffer: a Uint8Array view may be a window onto
  // a larger pooled buffer, and Blob would otherwise capture all of it.
  const copy = new Uint8Array(part.bytes.byteLength);
  copy.set(part.bytes);
  return new File([copy], `ref-${i + 1}.${ext}`, { type: part.mimeType });
}

function describeError(res: Response, json: OpenAIResponse | null): string {
  const err = json?.error;
  const code = err?.code ?? `http_${res.status}`;
  const base = `OpenAI request failed (${code}): ${err?.message ?? res.statusText}`;

  if (code === 'moderation_blocked') {
    const d = err?.moderation_details;
    const where = d?.moderation_stage ? ` at the ${d.moderation_stage} stage` : '';
    const cats = d?.categories?.length ? ` [${d.categories.join(', ')}]` : '';
    return `${base}${where}${cats}`;
  }
  if (res.status === 403) {
    return `${base} — the organization may need verification to use this model.`;
  }
  return base;
}

export async function executeOpenAI(
  request: GptImageCompiledRequest,
  env: OpenAIEnv,
): Promise<OpenAIResult> {
  const base = (env.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  let res: Response;

  if (request.variant === 'image-edit') {
    const form = new FormData();
    form.append('model', request.model);
    form.append('prompt', request.prompt);
    form.append('size', request.size);
    form.append('quality', request.quality);
    form.append('n', String(request.numberOfOutputs));
    request.imageParts.forEach((part, i) => {
      // Repeated `image[]` is the documented multipart shape.
      form.append('image[]', toFilePart(part, i));
    });
    // No Content-Type header — fetch must set the multipart boundary.
    res = await fetch(`${base}/images/edits`, {
      method: 'POST',
      headers: authHeaders(env),
      body: form,
    });
  } else {
    res = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        size: request.size,
        quality: request.quality,
        n: request.numberOfOutputs,
      }),
    });
  }

  const json = (await res.json().catch(() => null)) as OpenAIResponse | null;
  if (!res.ok || json?.error) throw new Error(describeError(res, json));

  const format = json?.output_format ?? 'png';
  const mimeType = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';

  const outputs = (json?.data ?? [])
    .filter((d): d is OpenAIImage & { b64_json: string } => typeof d.b64_json === 'string')
    .map((d) => ({ type: 'image' as const, base64: d.b64_json, mimeType }));

  if (outputs.length === 0) throw new Error('OpenAI returned no images.');

  return { status: 'completed', outputs };
}
