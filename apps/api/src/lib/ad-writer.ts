/**
 * One-Click AI Ad — the writing step.
 *
 * Sends the product images and the hidden brief to a Gemini vision model
 * over the REST API and returns one Seedance prompt. Models are tried in
 * order (Pro first; Flash when Pro errors), each at most twice when the
 * reply does not parse as a prompt. Nothing here charges the user: the
 * caller only creates the job once a prompt exists.
 */

import { buildAdBrief, extractAdPrompt } from '@clickfy/providers';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Pro writes the better concept; Flash is the fallback when Pro is unavailable. */
export const AD_WRITER_MODELS = ['gemini-3.1-pro-preview', 'gemini-3.8-flash'] as const;
const TIMEOUT_MS = 90_000;

export interface AdImage {
  bytes: ArrayBuffer;
  mimeType: string;
}

export class AdWriterError extends Error {
  constructor(message: string, readonly code: 'writer_unavailable' | 'writer_malformed') {
    super(message);
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function generate(model: string, apiKey: string, brief: string, images: AdImage[]): Promise<string> {
  const res = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            ...images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: toBase64(img.bytes) } })),
            { text: brief },
          ],
        },
      ],
      generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AdWriterError(`${model} → ${res.status}: ${text.slice(0, 200)}`, 'writer_unavailable');
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };
  if (json.promptFeedback?.blockReason) {
    throw new AdWriterError(`blocked: ${json.promptFeedback.blockReason}`, 'writer_malformed');
  }
  return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

/** The Seedance prompt for these images, and which model wrote it. */
export async function writeAdPrompt(args: {
  apiKey: string;
  images: AdImage[];
  notes?: string | null;
  /** The admin's saved brief, when there is one; else the code default. */
  template?: string | null;
}): Promise<{ prompt: string; writer: string }> {
  const brief = buildAdBrief({ imageCount: args.images.length, notes: args.notes, template: args.template });
  let lastError: Error | null = null;
  for (const model of AD_WRITER_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const reply = await generate(model, args.apiKey, brief, args.images);
        const prompt = extractAdPrompt(reply);
        if (prompt) return { prompt, writer: model };
        lastError = new AdWriterError(`${model} replied without a usable prompt`, 'writer_malformed');
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // A model that is down is not worth a second try; move to the next one.
        if (err instanceof AdWriterError && err.code === 'writer_unavailable') break;
      }
    }
  }
  throw lastError ?? new AdWriterError('no writer model answered', 'writer_unavailable');
}
