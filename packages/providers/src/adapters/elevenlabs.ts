/**
 * ElevenLabs — speech, sound effects and voice changing over plain
 * `fetch` with the `xi-api-key` header. Every call completes in seconds,
 * so each runs as a synchronous stage: no task id, no polling.
 *
 *   tts  POST /v1/text-to-speech/{voice}/with-timestamps
 *        JSON back: base64 audio plus per-character timings, and the last
 *        timing is the clip's length — the number cost tracking wants.
 *   sfx  POST /v1/sound-generation      → mp3 bytes
 *   sts  POST /v1/speech-to-speech/{voice}   multipart → mp3 bytes
 *
 * A voice from the public library has to be added to the account before
 * it can speak. The first request with such a voice answers
 * `voice_not_found`; when the request carries the voice's public owner id
 * the adapter adds it (`POST /v1/voices/add/{owner}/{voice}`) and retries
 * once. Added voices stay on the account, so this happens once per voice.
 *
 * Output format is `mp3_44100_128` everywhere: available on every plan
 * including free, and what the player expects.
 */

import type { ExecuteResult } from '../execute';
import type { ElevenLabsCompiledRequest } from '../compile-types';

export interface ElevenLabsEnv {
  apiKey: string;
}

const BASE = 'https://api.elevenlabs.io';
const OUTPUT_FORMAT = 'mp3_44100_128';
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export interface ElevenLabsUsage {
  /** Characters the provider billed (speech), when known. */
  chars: number | null;
  /** Clip length, from the timestamps (speech) or the request (effects). */
  durationSec: number | null;
  requestId: string | null;
}

export type ElevenLabsResult = ExecuteResult & { usage?: ElevenLabsUsage };

function headers(env: ElevenLabsEnv, extra: Record<string, string> = {}): Record<string, string> {
  return { 'xi-api-key': env.apiKey, ...extra };
}

async function readError(res: Response): Promise<{ status: string | null; message: string }> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { detail?: { status?: string; message?: string } | string };
    if (typeof json.detail === 'string') return { status: null, message: json.detail };
    return { status: json.detail?.status ?? null, message: json.detail?.message ?? text.slice(0, 300) };
  } catch {
    return { status: null, message: text.slice(0, 300) || res.statusText };
  }
}

function withTimeout(init: RequestInit): RequestInit {
  return { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
}

async function addLibraryVoice(req: ElevenLabsCompiledRequest, env: ElevenLabsEnv): Promise<boolean> {
  if (!req.voiceId || !req.publicOwnerId) return false;
  const res = await fetch(`${BASE}/v1/voices/add/${encodeURIComponent(req.publicOwnerId)}/${encodeURIComponent(req.voiceId)}`, withTimeout({
    method: 'POST',
    headers: headers(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ new_name: req.voiceName ?? req.voiceId }),
  }));
  if (res.ok) return true;
  const err = await readError(res);
  // Already on the account counts as added.
  return /already/i.test(err.message);
}

function base64Of(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString('base64');
}

async function tts(req: ElevenLabsCompiledRequest, env: ElevenLabsEnv, retried = false): Promise<ElevenLabsResult> {
  const url = `${BASE}/v1/text-to-speech/${encodeURIComponent(req.voiceId!)}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
  const body: Record<string, unknown> = { text: req.text, model_id: req.model };
  if (req.voiceSettings) {
    body.voice_settings = {
      ...(req.voiceSettings.stability !== undefined ? { stability: req.voiceSettings.stability } : {}),
      ...(req.voiceSettings.similarityBoost !== undefined ? { similarity_boost: req.voiceSettings.similarityBoost } : {}),
      ...(req.voiceSettings.speed !== undefined ? { speed: req.voiceSettings.speed } : {}),
    };
  }
  if (req.languageCode) body.language_code = req.languageCode;
  const res = await fetch(url, withTimeout({ method: 'POST', headers: headers(env, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) }));
  if (!res.ok) {
    const err = await readError(res);
    if (err.status === 'voice_not_found' && !retried && (await addLibraryVoice(req, env))) {
      return tts(req, env, true);
    }
    throw new Error(`ElevenLabs speech failed (${res.status}${err.status ? ` ${err.status}` : ''}): ${err.message}`);
  }
  const json = (await res.json()) as {
    audio_base64?: string;
    alignment?: { character_end_times_seconds?: number[] } | null;
    normalized_alignment?: { character_end_times_seconds?: number[] } | null;
  };
  if (!json.audio_base64) throw new Error('ElevenLabs speech returned no audio.');
  const ends = json.alignment?.character_end_times_seconds ?? json.normalized_alignment?.character_end_times_seconds ?? [];
  const durationSec = ends.length ? ends[ends.length - 1]! : undefined;
  return {
    status: 'completed',
    outputs: [{ type: 'audio', base64: json.audio_base64, mimeType: 'audio/mpeg', ...(durationSec ? { durationSec } : {}) }],
    usage: { chars: req.text?.length ?? null, durationSec: durationSec ?? null, requestId: res.headers.get('request-id') },
  };
}

async function sfx(req: ElevenLabsCompiledRequest, env: ElevenLabsEnv): Promise<ElevenLabsResult> {
  const body: Record<string, unknown> = { text: req.text, model_id: req.model };
  if (req.durationSeconds !== undefined) body.duration_seconds = req.durationSeconds;
  if (req.promptInfluence !== undefined) body.prompt_influence = req.promptInfluence;
  const res = await fetch(`${BASE}/v1/sound-generation?output_format=${OUTPUT_FORMAT}`, withTimeout({
    method: 'POST',
    headers: headers(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  }));
  if (!res.ok) {
    const err = await readError(res);
    throw new Error(`ElevenLabs sound effect failed (${res.status}${err.status ? ` ${err.status}` : ''}): ${err.message}`);
  }
  const bytes = await res.arrayBuffer();
  return {
    status: 'completed',
    outputs: [{ type: 'audio', base64: base64Of(bytes), mimeType: 'audio/mpeg', ...(req.durationSeconds ? { durationSec: req.durationSeconds } : {}) }],
    usage: { chars: null, durationSec: req.durationSeconds ?? null, requestId: res.headers.get('request-id') },
  };
}

async function sts(req: ElevenLabsCompiledRequest, env: ElevenLabsEnv, retried = false): Promise<ElevenLabsResult> {
  if (!req.audio) throw new Error('Voice changer needs an audio file.');
  let bytes: Uint8Array | undefined = req.audio.bytes;
  if (!bytes && req.audio.url) {
    const src = await fetch(req.audio.url);
    if (!src.ok) throw new Error(`Could not read the source audio (${src.status}).`);
    bytes = new Uint8Array(await src.arrayBuffer());
  }
  if (!bytes) throw new Error('Voice changer source audio has neither bytes nor a URL.');
  const form = new FormData();
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.set('audio', new Blob([ab], { type: req.audio.mimeType || 'audio/mpeg' }), 'source.mp3');
  form.set('model_id', req.model);
  if (req.voiceSettings) {
    form.set('voice_settings', JSON.stringify({
      ...(req.voiceSettings.stability !== undefined ? { stability: req.voiceSettings.stability } : {}),
      ...(req.voiceSettings.similarityBoost !== undefined ? { similarity_boost: req.voiceSettings.similarityBoost } : {}),
    }));
  }
  const res = await fetch(`${BASE}/v1/speech-to-speech/${encodeURIComponent(req.voiceId!)}?output_format=${OUTPUT_FORMAT}`, withTimeout({
    method: 'POST',
    headers: headers(env),
    body: form,
  }));
  if (!res.ok) {
    const err = await readError(res);
    if (err.status === 'voice_not_found' && !retried && (await addLibraryVoice(req, env))) {
      return sts(req, env, true);
    }
    throw new Error(`ElevenLabs voice changer failed (${res.status}${err.status ? ` ${err.status}` : ''}): ${err.message}`);
  }
  const out = await res.arrayBuffer();
  return {
    status: 'completed',
    outputs: [{ type: 'audio', base64: base64Of(out), mimeType: 'audio/mpeg' }],
    usage: { chars: null, durationSec: null, requestId: res.headers.get('request-id') },
  };
}

export async function executeElevenLabs(req: ElevenLabsCompiledRequest, env: ElevenLabsEnv): Promise<ElevenLabsResult> {
  switch (req.variant) {
    case 'tts':
      return tts(req, env);
    case 'sfx':
      return sfx(req, env);
    case 'sts':
      return sts(req, env);
  }
}
