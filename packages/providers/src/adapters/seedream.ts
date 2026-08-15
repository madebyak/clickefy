/**
 * Seedream adapter — BytePlus ModelArk image generation.
 *
 * Same host, same API key and the same account as the Seedance video
 * adapter next door; only the path and the shape differ. The important
 * distinction is that this endpoint is **synchronous**: `POST
 * /images/generations` blocks and returns the finished images inline, so
 * unlike Seedance there is no task id and no polling.
 *
 * Two vendor behaviours worth knowing:
 *
 *   - `watermark` defaults to TRUE server-side and burns a visible
 *     "AI generated" mark into the corner. The compiler always sends it
 *     explicitly; this adapter never omits the field.
 *   - Returned URLs are purged after 24 HOURS. Callers must copy the
 *     bytes into our own storage promptly — the jobs-worker already does
 *     this via `writeOutputObject`.
 */

import type { ImagePart, SeedreamCompiledRequest } from '../compile-types';

export interface SeedreamEnv {
  apiKey: string;
  /** Defaults to the ap-southeast (BytePlus international) region. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

/** Hosts ModelArk's servers can't reach — inline the bytes instead. */
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
 * Resolve an image part to something the `image` field accepts: either a
 * publicly fetchable URL or a `data:` URI. Mirrors the Seedance adapter,
 * including the localhost fallback that makes local dev work at all.
 */
function imageForSeedream(part: ImagePart): string {
  if (part.url && !UNREACHABLE_HOST_RE.test(part.url)) return part.url;
  if (part.bytes) return `data:${part.mimeType};base64,${bytesToBase64(part.bytes)}`;
  throw new Error(
    `Seedream adapter received an image part with no URL and no bytes (role=${part.role}, index=${part.index}). Hydrate the part before compile time.`,
  );
}

interface SeedreamImage {
  url?: string;
  b64_json?: string;
  size?: string;
  error?: { code?: string; message?: string };
}

interface SeedreamResponse {
  model?: string;
  data?: SeedreamImage[];
  usage?: { generated_images?: number; output_tokens?: number };
  error?: { code?: string; message?: string };
}

export interface SeedreamResult {
  status: 'completed';
  outputs: Array<{ type: 'image'; url?: string; base64?: string; mimeType: string }>;
}

/**
 * Run a Seedream image generation. Resolves only when the images exist —
 * there is no pending state to hand back.
 */
export async function executeSeedream(
  request: SeedreamCompiledRequest,
  env: SeedreamEnv,
): Promise<SeedreamResult> {
  const base = (env.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');

  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    watermark: request.watermark,
    // `url` keeps the response small; the worker copies to R2 well inside
    // the 24h window. b64 would balloon the payload for a batch of 4K images.
    response_format: 'url',
  };
  if (request.size) body.size = request.size;
  if (request.outputFormat) body.output_format = request.outputFormat;
  if (request.sequentialImageGeneration) {
    body.sequential_image_generation = request.sequentialImageGeneration;
    if (request.maxImages && request.maxImages > 1) {
      body.sequential_image_generation_options = { max_images: request.maxImages };
    }
  }
  if (request.images?.length) {
    // Single input may be a bare string, but the array form is accepted
    // for both — one shape keeps the adapter simple.
    body.image = request.images.map(imageForSeedream);
  }

  const res = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => null)) as SeedreamResponse | null;

  if (!res.ok || json?.error) {
    const code = json?.error?.code ?? `http_${res.status}`;
    const message = json?.error?.message ?? res.statusText;
    throw new Error(`Seedream request failed (${code}): ${message}`);
  }

  const images = json?.data ?? [];
  const outputs = images
    // Sequential generation tolerates partial failure: a single image can
    // carry its own `error` (usually moderation) while its siblings
    // succeed. Those are not billed, so drop them and keep the rest.
    .filter((img) => !img.error && (img.url || img.b64_json))
    .map((img) => ({
      type: 'image' as const,
      url: img.url,
      base64: img.b64_json,
      mimeType: request.outputFormat === 'png' ? 'image/png' : 'image/jpeg',
    }));

  if (outputs.length === 0) {
    // Surface the per-image reason when there is one — for a moderation
    // block that message is the only actionable detail the user gets.
    const reason = images.find((i) => i.error)?.error;
    throw new Error(
      reason
        ? `Seedream returned no images (${reason.code ?? 'blocked'}): ${reason.message ?? 'content rejected'}`
        : 'Seedream returned no images.',
    );
  }

  return { status: 'completed', outputs };
}
