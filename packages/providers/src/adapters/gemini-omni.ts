/**
 * Gemini Omni Flash — Google's video model, called directly on the
 * Gemini API (founder's choice, 2026-10-05: not through fal).
 *
 * THE CONTRACT, as probed on 2026-10-04 with a real request:
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   headers: x-goog-api-key
 *   body: { model, input, response_format: { type: 'video', aspect_ratio,
 *           resolution, delivery: 'uri' }, generation_config?: { video_config: { task } } }
 *
 *   The call BLOCKS until the clip exists (23 s for a 3 s 360p clip) and
 *   answers `status: "completed"` with the video as a Files-API download
 *   URI inside `steps[].content[]`, plus a `usage` block whose
 *   `output_tokens_by_modality[modality=video].tokens` is what Google
 *   bills (5,793 tokens for 3 s at 360p; the docs quote 5,792 per second
 *   at 720p). `delivery: 'uri'` is mandatory for us — inline base64 is
 *   capped at 4 MB.
 *
 *   The file must then be read with the same key: GET /v1beta/files/{id}
 *   until `state: "ACTIVE"`, then GET the `:download?alt=media` URI. The
 *   worker cannot fetch that URL unauthenticated, so this adapter
 *   downloads the bytes itself and hands them back inline, the way the
 *   Gemini image adapter does.
 *
 * NO DURATION CONTROL. The model picks 3–10 s from the prompt; there is
 * no request field for it. Pricing therefore assumes a typical clip per
 * tier (see the registry entry) and the real token count is logged so
 * day 3's cost tracking can bill what Google actually charged.
 *
 * Generation can run several minutes at 1080p. Node's fetch gives up on
 * headers after 5 minutes, so when undici is available the call goes
 * through an agent with that limit removed; otherwise plain fetch.
 */

import type { ExecuteResult } from '../execute';
import type { GeminiOmniCompiledRequest } from '../compile-types';
import type { GeminiEnv } from './gemini';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Hard ceiling on one generation, including the file becoming ACTIVE. */
const GENERATION_TIMEOUT_MS = 20 * 60 * 1000;
const FILE_POLL_INTERVAL_MS = 2_000;
const FILE_POLL_TIMEOUT_MS = 3 * 60 * 1000;

interface InteractionResponse {
  id?: string;
  status?: string;
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; uri?: string; mime_type?: string; data?: string; text?: string }>;
  }>;
  usage?: {
    total_output_tokens?: number;
    total_input_tokens?: number;
    output_tokens_by_modality?: Array<{ modality?: string; tokens?: number }>;
  };
  error?: { message?: string; status?: string; code?: number };
}

/** Billing-relevant facts from one call, for logs now and cost rows on day 3. */
export interface GeminiOmniUsage {
  videoTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationSec: number | null;
  interactionId: string | null;
}

export type GeminiOmniResult = ExecuteResult & { usage?: GeminiOmniUsage };

async function longFetch(url: string, init: RequestInit): Promise<Response> {
  // undici is Node's fetch engine; an Agent with the header timeout off
  // lets a multi-minute generation answer. Absent (Workers), plain fetch.
  try {
    const undici = (await import('undici')) as { Agent?: new (o: Record<string, unknown>) => unknown };
    if (undici.Agent) {
      const dispatcher = new undici.Agent({ headersTimeout: 0, bodyTimeout: 0 });
      return fetch(url, { ...init, ...({ dispatcher } as object) });
    }
  } catch {
    // not available
  }
  return fetch(url, init);
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export async function executeGeminiOmni(
  request: GeminiOmniCompiledRequest,
  env: GeminiEnv,
): Promise<GeminiOmniResult> {
  if (!env.apiKey) throw new Error('Gemini Omni adapter requires `env.apiKey`. Set GEMINI_API_KEY.');
  const headers = { 'x-goog-api-key': env.apiKey, 'Content-Type': 'application/json' };

  // ── Input: images first (inline base64), then the prompt ────────────
  const input: Array<Record<string, unknown>> = [];
  for (const part of request.images) {
    let bytes = part.bytes;
    if (!bytes && part.url) {
      const r = await fetch(part.url);
      if (!r.ok) throw new Error(`Gemini Omni: could not fetch input image ${part.url}: ${r.status}`);
      bytes = new Uint8Array(await r.arrayBuffer());
    }
    if (!bytes) throw new Error('Gemini Omni: an input image has neither bytes nor a URL.');
    input.push({ type: 'image', data: toBase64(bytes), mime_type: part.mimeType || 'image/png' });
  }
  input.push({ type: 'text', text: request.prompt });

  const body: Record<string, unknown> = {
    model: request.model,
    input: input.length === 1 ? request.prompt : input,
    response_format: {
      type: 'video',
      aspect_ratio: request.aspectRatio,
      resolution: request.resolution,
      delivery: 'uri',
    },
  };
  if (request.task) body.generation_config = { video_config: { task: request.task } };

  const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
  const res = await longFetch(`${BASE}/interactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini Omni ${res.status}: ${text.slice(0, 400)}`);
  }
  let data: InteractionResponse;
  try {
    data = JSON.parse(text) as InteractionResponse;
  } catch {
    throw new Error(`Gemini Omni returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (data.error) throw new Error(`Gemini Omni error: ${data.error.message ?? JSON.stringify(data.error)}`);
  if (data.status && data.status !== 'completed') {
    throw new Error(`Gemini Omni finished with status "${data.status}"`);
  }

  // ── Find the clip ────────────────────────────────────────────────────
  const video = data.steps
    ?.filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .find((c) => c.type === 'video');
  if (!video) {
    const refusal = data.steps
      ?.flatMap((s) => s.content ?? [])
      .find((c) => c.type === 'text')?.text;
    throw new Error(
      `Gemini Omni returned no video${refusal ? `: ${refusal.slice(0, 300)}` : ''}`,
    );
  }

  const videoTokens =
    data.usage?.output_tokens_by_modality?.find((m) => m.modality === 'video')?.tokens ?? null;
  const usage: GeminiOmniUsage = {
    videoTokens,
    inputTokens: data.usage?.total_input_tokens ?? null,
    outputTokens: data.usage?.total_output_tokens ?? null,
    durationSec: null,
    interactionId: data.id ?? null,
  };

  // Inline (small clips) — unlikely with delivery: 'uri', handled anyway.
  if (video.data) {
    return {
      status: 'completed',
      outputs: [{ type: 'video', base64: video.data, mimeType: video.mime_type ?? 'video/mp4' }],
      usage,
    };
  }
  if (!video.uri) throw new Error('Gemini Omni returned a video part with neither data nor uri.');

  // ── Wait for the file, then download it with the key ─────────────────
  const fileId = video.uri.match(/\/files\/([^:/?]+)/)?.[1];
  if (!fileId) throw new Error(`Gemini Omni returned an unrecognised file uri: ${video.uri}`);
  const started = Date.now();
  for (;;) {
    const meta = (await (await fetch(`${BASE}/files/${fileId}`, { headers, signal })).json()) as {
      state?: string;
      videoMetadata?: { videoDuration?: string };
      error?: { message?: string };
    };
    if (meta.error) throw new Error(`Gemini Omni file lookup failed: ${meta.error.message}`);
    if (meta.state === 'ACTIVE') {
      const d = meta.videoMetadata?.videoDuration?.match(/^([\d.]+)s$/)?.[1];
      usage.durationSec = d ? Number(d) : null;
      break;
    }
    if (meta.state === 'FAILED') throw new Error('Gemini Omni video file failed to process.');
    if (Date.now() - started > FILE_POLL_TIMEOUT_MS) {
      throw new Error('Gemini Omni video file did not become ACTIVE in time.');
    }
    await new Promise((r) => setTimeout(r, FILE_POLL_INTERVAL_MS));
  }

  const dl = await fetch(video.uri, { headers: { 'x-goog-api-key': env.apiKey }, signal });
  if (!dl.ok) throw new Error(`Gemini Omni video download failed: ${dl.status}`);
  const bytes = new Uint8Array(await dl.arrayBuffer());

  return {
    status: 'completed',
    outputs: [
      {
        type: 'video',
        base64: toBase64(bytes),
        mimeType: video.mime_type ?? 'video/mp4',
        ...(usage.durationSec != null ? { durationSec: usage.durationSec } : {}),
      },
    ],
    usage,
  };
}
