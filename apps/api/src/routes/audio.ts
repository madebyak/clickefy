/**
 * `/v1/audio/voices` — the voices the Speech and Voice-changer tabs offer.
 *
 * Two sources, merged: the voices already on the ElevenLabs account
 * (`GET /v2/voices`) and a curated slice of the public library
 * (`GET /v1/shared-voices`: free to use, not live-moderated, English and
 * Arabic, by popularity). A library voice carries its `publicOwnerId`,
 * which the worker needs to add it to the account the first time it
 * speaks. Cached per isolate for an hour: the list changes when the
 * client adds a voice in their ElevenLabs dashboard, not per request.
 */

import { Hono } from 'hono';

import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const audioRoute = new Hono<AppEnv>();

export interface AudioVoice {
  voiceId: string;
  name: string;
  previewUrl: string | null;
  /** `account`: already on the account. `library`: public, added on first use. */
  source: 'account' | 'library';
  publicOwnerId?: string;
  language: string | null;
  gender: string | null;
  accent: string | null;
  age: string | null;
  useCase: string | null;
  description: string | null;
}

const BASE = 'https://api.elevenlabs.io';
const CACHE_TTL_MS = 60 * 60 * 1000;
const LIBRARY_LANGUAGES = ['en', 'ar'] as const;
const LIBRARY_PAGE = 40;

let cache: { at: number; voices: AudioVoice[] } | null = null;
let inFlight: Promise<AudioVoice[]> | null = null;

interface AccountVoice {
  voice_id: string;
  name: string;
  preview_url?: string | null;
  labels?: Record<string, string | undefined>;
  description?: string | null;
}

interface SharedVoice {
  voice_id: string;
  public_owner_id: string;
  name: string;
  preview_url?: string | null;
  language?: string | null;
  gender?: string | null;
  accent?: string | null;
  age?: string | null;
  use_case?: string | null;
  description?: string | null;
  free_users_allowed?: boolean;
  live_moderation_enabled?: boolean;
  rate?: number | null;
}

async function elevenGet<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ElevenLabs ${path} → ${res.status}`);
  return (await res.json()) as T;
}

function fromAccount(v: AccountVoice): AudioVoice {
  const l = v.labels ?? {};
  return {
    voiceId: v.voice_id,
    name: v.name,
    previewUrl: v.preview_url ?? null,
    source: 'account',
    language: l.language ?? null,
    gender: l.gender ?? null,
    accent: l.accent ?? null,
    age: l.age ?? null,
    useCase: l.use_case ?? l.usecase ?? null,
    description: v.description ?? l.description ?? null,
  };
}

function fromLibrary(v: SharedVoice): AudioVoice {
  return {
    voiceId: v.voice_id,
    name: v.name,
    previewUrl: v.preview_url ?? null,
    source: 'library',
    publicOwnerId: v.public_owner_id,
    language: v.language ?? null,
    gender: v.gender ?? null,
    accent: v.accent ?? null,
    age: v.age ?? null,
    useCase: v.use_case ?? null,
    description: v.description ?? null,
  };
}

async function loadVoices(apiKey: string): Promise<AudioVoice[]> {
  // The free tier refuses library voices over the API (402), so a free
  // account only sees what is already on it. Paid plans get the library.
  const sub = await elevenGet<{ tier?: string }>('/v1/user/subscription', apiKey).catch(() => ({ tier: 'free' }));
  const paid = (sub.tier ?? 'free') !== 'free';
  const [account, ...library] = await Promise.all([
    elevenGet<{ voices?: AccountVoice[] }>('/v2/voices?page_size=100', apiKey).catch(() => ({ voices: [] as AccountVoice[] })),
    ...(paid ? LIBRARY_LANGUAGES : []).map((lang) =>
      elevenGet<{ voices?: SharedVoice[] }>(
        `/v1/shared-voices?page_size=${LIBRARY_PAGE}&language=${lang}&sort=cloned_by_count&free_users_allowed=true`,
        apiKey,
      ).catch(() => ({ voices: [] as SharedVoice[] })),
    ),
  ]);
  const out: AudioVoice[] = [];
  const seen = new Set<string>();
  for (const v of account.voices ?? []) {
    if (seen.has(v.voice_id)) continue;
    seen.add(v.voice_id);
    out.push(fromAccount(v));
  }
  for (const page of library) {
    for (const v of page.voices ?? []) {
      if (seen.has(v.voice_id)) continue;
      // The licence terms the plan set: free to use, not live-moderated, no custom per-use rate.
      if (v.free_users_allowed === false || v.live_moderation_enabled || (v.rate ?? 0) > 0) continue;
      seen.add(v.voice_id);
      out.push(fromLibrary(v));
    }
  }
  return out;
}

audioRoute.get(
  '/voices',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  async (c) => {
    const apiKey = c.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return c.json({ error: { code: 'audio_not_configured', message: 'Voices are not available right now.' } }, 503);
    }
    const now = Date.now();
    if (!cache || now - cache.at > CACHE_TTL_MS) {
      inFlight ??= loadVoices(apiKey).finally(() => {
        inFlight = null;
      });
      try {
        const voices = await inFlight;
        cache = { at: now, voices };
      } catch (err) {
        if (!cache) {
          console.error('[audio] voices load failed:', err instanceof Error ? err.message : err);
          return c.json({ error: { code: 'voices_unavailable', message: 'Could not load voices.' } }, 502);
        }
        // Stale beats empty: keep serving the last good list.
      }
    }
    c.header('Cache-Control', 'private, max-age=300');
    return c.json({ data: { voices: cache.voices } });
  },
);
