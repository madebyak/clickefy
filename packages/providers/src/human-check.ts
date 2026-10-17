/**
 * "Does this attachment show a person?" — the gate in front of the
 * BytePlus asset library.
 *
 * Seedance rejects references with human faces; the library accepts
 * AI-generated people once they are registered. Registering every
 * attachment would burn the library's 50 slots and 3-per-minute upload
 * rate on product shots and landscapes, so a fast Gemini vision model
 * looks first and only media with a realistic human goes through.
 *
 * Deliberately conservative about what counts: a photographic or
 * realistic-looking human (real photo or AI-generated) is `true`; cartoons,
 * anime, line art, mannequins and statues are `false`, since Seedance's
 * face moderation does not fire on those. A media file too large to send
 * inline is assumed to contain a person — verifying one extra file costs
 * a slot for a few minutes, while skipping a real one fails the job.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Flash answers in about two seconds; Pro only if Flash is down. */
export const HUMAN_CHECK_MODELS = ['gemini-3.8-flash', 'gemini-3.1-pro-preview'] as const;
const TIMEOUT_MS = 45_000;
/** Gemini's inline-data ceiling is 20 MB per request; leave headroom for the JSON. */
export const HUMAN_CHECK_MAX_INLINE_BYTES = 15 * 1024 * 1024;

const PROMPT = [
  'Look at the attached media. Does it show a HUMAN PERSON that looks real: a photograph of a person,',
  'or a photorealistic / realistic AI-generated person (any visible face, head or body counts, even small or partial)?',
  'Answer true for realistic humans. Answer false when there are no people, or the people are clearly cartoons,',
  'anime, illustrations, line art, pixel art, mannequins, dolls, statues or toys.',
  'Reply with JSON only: {"human": true|false, "reason": "<ten words at most>"}.',
].join(' ');

export interface HumanCheckInput {
  apiKey: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface HumanCheckResult {
  human: boolean;
  /** Which model answered, or `assumed` when the file was too large to ask. */
  model: string;
  reason: string;
}

export class HumanCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HumanCheckError';
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function ask(model: string, input: HumanCheckInput): Promise<HumanCheckResult> {
  const res = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: input.mimeType, data: toBase64(input.bytes) } },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 200,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { human: { type: 'BOOLEAN' }, reason: { type: 'STRING' } },
          required: ['human'],
        },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HumanCheckError(`${model} → ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    promptFeedback?: { blockReason?: string };
  };
  // A safety block on the input is itself a strong signal of a person.
  if (json.promptFeedback?.blockReason) {
    return { human: true, model, reason: `blocked: ${json.promptFeedback.blockReason}` };
  }
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  try {
    const parsed = JSON.parse(text) as { human?: unknown; reason?: unknown };
    if (typeof parsed.human !== 'boolean') throw new Error('no boolean');
    return { human: parsed.human, model, reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 120) : '' };
  } catch {
    throw new HumanCheckError(`${model} replied without a verdict: ${text.slice(0, 120)}`);
  }
}

/**
 * Ask the first model that answers. Throws `HumanCheckError` only when every
 * model failed; the caller decides whether to assume a person or retry.
 */
export async function detectHuman(input: HumanCheckInput): Promise<HumanCheckResult> {
  if (input.bytes.byteLength > HUMAN_CHECK_MAX_INLINE_BYTES) {
    return { human: true, model: 'assumed', reason: 'file too large to inspect; verified to be safe' };
  }
  let lastError: unknown;
  for (const model of HUMAN_CHECK_MODELS) {
    try {
      return await ask(model, input);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new HumanCheckError('no model answered');
}
