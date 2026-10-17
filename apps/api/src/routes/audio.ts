/**
 * `/v1/audio/voices` — the voices the Speech and Voice-changer tabs offer.
 *
 * Two sources, merged: the voices already on the ElevenLabs account
 * (`GET /v2/voices`) and a curated slice of the public library
 * (`GET /v1/shared-voices`: free to use, not live-moderated, the 300 most
 * used English and the 300 most used Arabic voices). A library voice carries its `publicOwnerId`,
 * which the worker needs to add it to the account the first time it
 * speaks. Cached per isolate for an hour: the list changes when the
 * client adds a voice in their ElevenLabs dashboard, not per request.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { userVoices, type UserVoice } from '@clickfy/db';

import { chargeCredits } from '../lib/credit-charge';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const audioRoute = new Hono<AppEnv>();

export interface AudioVoice {
  voiceId: string;
  name: string;
  previewUrl: string | null;
  /**
   * `account`: a premade voice on the account, shared by everyone.
   * `library`: public, added on first use. `own`: made by this user (a
   * clone or a design); private to them.
   */
  source: 'account' | 'library' | 'own';
  publicOwnerId?: string;
  /** `own` voices: our row id (for delete) and how it was made. */
  ownedId?: string;
  origin?: 'cloned' | 'designed';
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
/** The library serves at most 100 a page; three pages per language = the 300 most used. */
const LIBRARY_PAGE = 100;
const LIBRARY_PAGES = 3;
const SEARCH_PAGE = 40;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const searchCache = new Map<string, { at: number; voices: AudioVoice[] }>();

let cache: { at: number; voices: AudioVoice[] } | null = null;
let inFlight: Promise<AudioVoice[]> | null = null;
/** Preview clips of the account's non-shared voices, filled while loading the list. */
const previewByVoiceId = new Map<string, string | null>();

function invalidateVoiceCache() {
  cache = null;
}

function fromOwned(row: UserVoice): AudioVoice {
  const l = row.labels ?? {};
  return {
    voiceId: row.elevenlabsVoiceId,
    name: row.name,
    previewUrl: previewByVoiceId.get(row.elevenlabsVoiceId) ?? null,
    source: 'own',
    ownedId: row.id,
    origin: row.origin,
    language: l.language ?? null,
    gender: l.gender ?? null,
    accent: l.accent ?? null,
    age: l.age ?? null,
    useCase: null,
    description: row.description,
  };
}

async function ownedVoices(db: AppEnv['Variables']['db'], userId: string): Promise<UserVoice[]> {
  return db.query.userVoices.findMany({
    where: and(eq(userVoices.userId, userId), eq(userVoices.status, 'ready')),
    orderBy: [desc(userVoices.createdAt)],
  });
}

interface AccountVoice {
  voice_id: string;
  name: string;
  /** premade | professional | cloned | generated. Only the first two are shared. */
  category?: string;
  preview_url?: string | null;
  labels?: Record<string, string | undefined>;
  description?: string | null;
}

/** Voices every user may use: ElevenLabs's premade set and the client's own professional clone. */
const SHARED_CATEGORIES = new Set(['premade', 'professional']);

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

/** The licence terms the plan set: free to use, not live-moderated, no custom per-use rate. */
function usable(v: SharedVoice): boolean {
  return v.free_users_allowed !== false && !v.live_moderation_enabled && (v.rate ?? 0) <= 0;
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
  const libraryRequests = paid
    ? LIBRARY_LANGUAGES.flatMap((lang) =>
        Array.from({ length: LIBRARY_PAGES }, (_, page) =>
          elevenGet<{ voices?: SharedVoice[] }>(
            `/v1/shared-voices?page_size=${LIBRARY_PAGE}&page=${page}&language=${lang}&sort=cloned_by_count&free_users_allowed=true`,
            apiKey,
          ).catch(() => ({ voices: [] as SharedVoice[] })),
        ),
      )
    : [];
  const [account, ...library] = await Promise.all([
    elevenGet<{ voices?: AccountVoice[] }>('/v2/voices?page_size=100', apiKey).catch(() => ({ voices: [] as AccountVoice[] })),
    ...libraryRequests,
  ]);
  const out: AudioVoice[] = [];
  const seen = new Set<string>();
  for (const v of account.voices ?? []) {
    if (seen.has(v.voice_id)) continue;
    seen.add(v.voice_id);
    // Users' clones and designs are on this same account; they are served
    // per user from `user_voices`, never from the shared list.
    if (!SHARED_CATEGORIES.has(v.category ?? 'premade')) {
      previewByVoiceId.set(v.voice_id, v.preview_url ?? null);
      continue;
    }
    out.push(fromAccount(v));
  }
  for (const page of library) {
    for (const v of page.voices ?? []) {
      if (seen.has(v.voice_id)) continue;
      if (!usable(v)) continue;
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
    const own = (await ownedVoices(c.var.db, c.var.user!.id)).map(fromOwned);
    c.header('Cache-Control', 'private, max-age=60');
    return c.json({ data: { voices: [...own, ...cache.voices] } });
  },
);

/**
 * `GET /voices/search` — the whole public library, live. `q` matches
 * name and description; `language` is en | ar (both when absent);
 * `gender`, `age` and `useCase` are the library's own facets. Cached ten
 * minutes per distinct query.
 */
const searchSchema = z.object({
  q: z.string().trim().max(80).optional(),
  language: z.enum(['en', 'ar']).optional(),
  gender: z.enum(['male', 'female', 'neutral']).optional(),
  age: z.enum(['young', 'middle_aged', 'old']).optional(),
  useCase: z.string().trim().max(40).optional(),
});

audioRoute.get(
  '/voices/search',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  zValidator('query', searchSchema),
  async (c) => {
    const apiKey = c.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return c.json({ error: { code: 'audio_not_configured', message: 'Voices are not available right now.' } }, 503);
    }
    const q = c.req.valid('query');
    const key = JSON.stringify(q);
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS) {
      c.header('Cache-Control', 'private, max-age=120');
      return c.json({ data: { voices: hit.voices } });
    }
    const languages = q.language ? [q.language] : [...LIBRARY_LANGUAGES];
    const pages = await Promise.all(
      languages.map((lang) => {
        const params = new URLSearchParams({ page_size: String(SEARCH_PAGE), language: lang, sort: 'cloned_by_count', free_users_allowed: 'true' });
        if (q.q) params.set('search', q.q);
        if (q.gender) params.set('gender', q.gender);
        if (q.age) params.set('age', q.age);
        if (q.useCase) params.set('use_cases', q.useCase);
        return elevenGet<{ voices?: SharedVoice[] }>(`/v1/shared-voices?${params.toString()}`, apiKey).catch(() => ({ voices: [] as SharedVoice[] }));
      }),
    );
    const seen = new Set<string>();
    const voices: AudioVoice[] = [];
    for (const page of pages) {
      for (const v of page.voices ?? []) {
        if (seen.has(v.voice_id) || !usable(v)) continue;
        seen.add(v.voice_id);
        voices.push(fromLibrary(v));
      }
    }
    searchCache.set(key, { at: Date.now(), voices });
    c.header('Cache-Control', 'private, max-age=120');
    return c.json({ data: { voices } });
  },
);

// ─── Voices users make ──────────────────────────────────────────────
//
// A clone (from a recording) or a design (from a description) becomes a
// voice on the client's ElevenLabs account, private to its maker through
// `user_voices`. The account's custom-voice slots are finite (30 on
// Creator) and shared by every user, so: paid plans only, a cap per user,
// and a guard that keeps the last slots free. Credits are charged after
// ElevenLabs accepted the voice, so a refused charge undoes the voice
// rather than needing a refund.

/** Voices a user may hold at once. */
export const VOICE_CAP_PER_USER = 2;
/** Stop creating when this many account slots are still free — room for the client's own voices. */
const ACCOUNT_SLOTS_RESERVED = 2;
export const VOICE_CLONE_CREDITS = 20;
export const VOICE_DESIGN_CREDITS = 10;
/** The consent text version a clone was made under; bump when the wording changes. */
const CONSENT_VERSION = '2026-10-17';
const CLONE_MAX_FILES = 5;
const CLONE_MAX_FILE_BYTES = 10 * 1024 * 1024;
const CLONE_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const SLOTS_TTL_MS = 60_000;

interface Subscription {
  tier?: string;
  voice_slots_used?: number;
  voice_limit?: number;
  can_use_instant_voice_cloning?: boolean;
  /** Creator allows 95 voice adds/edits a month across the account; each clone, design and delete counts. */
  voice_add_edit_counter?: number;
  max_voice_add_edits?: number;
}
let slotsCache: { at: number; sub: Subscription } | null = null;

async function accountSlots(apiKey: string, fresh = false): Promise<Subscription> {
  if (!fresh && slotsCache && Date.now() - slotsCache.at < SLOTS_TTL_MS) return slotsCache.sub;
  const sub = await elevenGet<Subscription>('/v1/user/subscription', apiKey);
  slotsCache = { at: Date.now(), sub };
  return sub;
}

type VoiceGateReason = 'plan' | 'user_cap' | 'account_full' | 'cloning_unavailable';

interface VoiceQuota {
  used: number;
  cap: number;
  accountUsed: number;
  accountLimit: number;
  cloneCredits: number;
  designCredits: number;
  /** Null when the user may make a voice now; else why not. */
  blocked: VoiceGateReason | null;
}

async function voiceQuotaFor(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, apiKey: string, fresh = false): Promise<VoiceQuota> {
  const user = c.var.user!;
  const [own, sub] = await Promise.all([ownedVoices(c.var.db, user.id), accountSlots(apiKey, fresh).catch(() => ({}) as Subscription)]);
  const accountUsed = sub.voice_slots_used ?? 0;
  const accountLimit = sub.voice_limit ?? 0;
  let blocked: VoiceGateReason | null = null;
  if (user.entitlement === 'free') blocked = 'plan';
  else if (sub.can_use_instant_voice_cloning === false) blocked = 'cloning_unavailable';
  else if (own.length >= VOICE_CAP_PER_USER) blocked = 'user_cap';
  else if (accountLimit > 0 && accountUsed >= accountLimit - ACCOUNT_SLOTS_RESERVED) blocked = 'account_full';
  else if (typeof sub.max_voice_add_edits === 'number' && (sub.voice_add_edit_counter ?? 0) >= sub.max_voice_add_edits - ACCOUNT_SLOTS_RESERVED) blocked = 'account_full';
  return { used: own.length, cap: VOICE_CAP_PER_USER, accountUsed, accountLimit, cloneCredits: VOICE_CLONE_CREDITS, designCredits: VOICE_DESIGN_CREDITS, blocked };
}

const GATE_MESSAGES: Record<VoiceGateReason, { status: 402 | 403 | 409 | 503; message: string }> = {
  plan: { status: 403, message: 'Creating a voice needs a paid plan.' },
  user_cap: { status: 409, message: `You can keep up to ${VOICE_CAP_PER_USER} voices. Delete one to make another.` },
  account_full: { status: 503, message: 'No voice slots are free right now. Try again later.' },
  cloning_unavailable: { status: 503, message: 'Voice creation is not available right now.' },
};

async function elevenDeleteVoice(apiKey: string, voiceId: string): Promise<void> {
  const res = await fetch(`${BASE}/v1/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE', headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok && res.status !== 404) throw new Error(`ElevenLabs delete voice → ${res.status}`);
}

async function elevenError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { detail?: { message?: string } | string };
    const d = json.detail;
    return (typeof d === 'string' ? d : d?.message) ?? text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

/** Record the voice, charge for it, and answer; undo the ElevenLabs voice when the charge is refused. */
async function finishVoice(
  c: { env: AppEnv['Bindings']; var: AppEnv['Variables']; json: (body: unknown, status?: 200 | 201 | 402) => Response },
  apiKey: string,
  args: { voiceId: string; name: string; description: string | null; origin: 'cloned' | 'designed'; credits: number; consent: boolean; pending: boolean; previewUrl?: string | null },
): Promise<Response> {
  const user = c.var.user!;
  const charged = await chargeCredits(c.var.db, {
    userId: user.id,
    cost: args.credits,
    reason: 'voice_charge',
    metadata: { kind: `voice_${args.origin}`, elevenlabsVoiceId: args.voiceId, name: args.name },
  });
  if (!charged) {
    await elevenDeleteVoice(apiKey, args.voiceId).catch(() => undefined);
    return c.json({ error: { code: 'insufficient_credits', message: `Making a voice costs ${args.credits} credits.` } }, 402);
  }
  const [row] = await c.var.db
    .insert(userVoices)
    .values({
      userId: user.id,
      elevenlabsVoiceId: args.voiceId,
      name: args.name,
      description: args.description,
      origin: args.origin,
      status: args.pending ? 'pending_verification' : 'ready',
      creditsCharged: String(args.credits),
      consentAt: args.consent ? new Date() : null,
      consentVersion: args.consent ? CONSENT_VERSION : null,
    })
    .returning();
  if (args.previewUrl !== undefined) previewByVoiceId.set(args.voiceId, args.previewUrl);
  invalidateVoiceCache();
  slotsCache = null;
  return c.json({ data: { voice: fromOwned(row!), creditsRemaining: charged.creditsRemaining } }, 201);
}

audioRoute.get(
  '/voices/quota',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  async (c) => {
    const apiKey = c.env.ELEVENLABS_API_KEY;
    if (!apiKey) return c.json({ error: { code: 'audio_not_configured', message: 'Voices are not available right now.' } }, 503);
    c.header('Cache-Control', 'no-store');
    return c.json({ data: await voiceQuotaFor(c, apiKey) });
  },
);

/**
 * `POST /voices/clone` — multipart: `name`, `files` (1–5 recordings,
 * 1–2 minutes of clean speech is the sweet spot), optional `description`,
 * and `consent=true`, the user's confirmation that they hold the rights
 * to this voice. 20 credits.
 */
audioRoute.post(
  '/voices/clone',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  async (c) => {
    const apiKey = c.env.ELEVENLABS_API_KEY;
    if (!apiKey) return c.json({ error: { code: 'audio_not_configured', message: 'Voices are not available right now.' } }, 503);
    const quota = await voiceQuotaFor(c, apiKey, true);
    if (quota.blocked) {
      const g = GATE_MESSAGES[quota.blocked];
      return c.json({ error: { code: `voice_${quota.blocked}`, message: g.message } }, g.status);
    }
    const user = c.var.user!;
    if (user.creditsBalance < VOICE_CLONE_CREDITS) {
      return c.json({ error: { code: 'insufficient_credits', message: `Cloning a voice costs ${VOICE_CLONE_CREDITS} credits.` } }, 402);
    }
    const form = await c.req.formData();
    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim().slice(0, 300) || null;
    const consent = form.get('consent') === 'true';
    // The Workers typings call every entry a string; files are Blobs with a name.
    type Upload = Blob & { name?: string };
    const files = (form.getAll('files') as unknown as Array<string | Upload>).filter(
      (f): f is Upload => typeof f !== 'string' && typeof f.size === 'number' && f.size > 0,
    );
    if (name.length < 1 || name.length > 60) return c.json({ error: { code: 'name_invalid', message: 'Give the voice a name (up to 60 characters).' } }, 422);
    if (!consent) return c.json({ error: { code: 'consent_required', message: 'Confirm you have the right to use this voice.' } }, 422);
    if (files.length === 0 || files.length > CLONE_MAX_FILES) return c.json({ error: { code: 'files_invalid', message: `Add 1 to ${CLONE_MAX_FILES} recordings.` } }, 422);
    let total = 0;
    for (const f of files) {
      if (!/^(audio\/|video\/webm)/.test(f.type)) return c.json({ error: { code: 'files_invalid', message: 'Recordings must be audio files.' } }, 422);
      if (f.size > CLONE_MAX_FILE_BYTES) return c.json({ error: { code: 'file_too_large', message: 'Each recording can be up to 10 MB.' } }, 422);
      total += f.size;
    }
    if (total > CLONE_MAX_TOTAL_BYTES) return c.json({ error: { code: 'file_too_large', message: 'Recordings can total up to 25 MB.' } }, 422);

    const body = new FormData();
    body.set('name', name);
    if (description) body.set('description', description);
    body.set('remove_background_noise', 'false');
    for (const f of files) body.append('files', f, f.name ?? 'recording.webm');
    const res = await fetch(`${BASE}/v1/voices/add`, { method: 'POST', headers: { 'xi-api-key': apiKey }, body, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      const message = await elevenError(res);
      console.error('[audio] clone failed:', res.status, message);
      return c.json({ error: { code: 'clone_failed', message: message || 'The voice could not be created from these recordings.' } }, 502);
    }
    const created = (await res.json()) as { voice_id: string; requires_verification?: boolean };
    return finishVoice(c, apiKey, { voiceId: created.voice_id, name, description, origin: 'cloned', credits: VOICE_CLONE_CREDITS, consent: true, pending: created.requires_verification === true, previewUrl: null });
  },
);

/**
 * `POST /voices/design` — three previews of a voice described in words.
 * Free of our credits (ElevenLabs bills the text), rate-limited; the user
 * pays when a preview is saved.
 */
const designSchema = z.object({
  description: z.string().trim().min(20).max(1000),
  /** The line the previews speak; ElevenLabs writes one to fit when absent. */
  text: z.string().trim().min(100).max(1000).optional(),
});

audioRoute.post(
  '/voices/design',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  zValidator('json', designSchema),
  async (c) => {
    const apiKey = c.env.ELEVENLABS_API_KEY;
    if (!apiKey) return c.json({ error: { code: 'audio_not_configured', message: 'Voices are not available right now.' } }, 503);
    const quota = await voiceQuotaFor(c, apiKey);
    if (quota.blocked) {
      const g = GATE_MESSAGES[quota.blocked];
      return c.json({ error: { code: `voice_${quota.blocked}`, message: g.message } }, g.status);
    }
    const body = c.req.valid('json');
    const res = await fetch(`${BASE}/v1/text-to-voice/design?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        voice_description: body.description,
        model_id: 'eleven_multilingual_ttv_v2',
        ...(body.text ? { text: body.text } : { auto_generate_text: true }),
      }),
    });
    if (!res.ok) {
      const message = await elevenError(res);
      console.error('[audio] design failed:', res.status, message);
      return c.json({ error: { code: 'design_failed', message: message || 'Could not design a voice from that description.' } }, 502);
    }
    const json = (await res.json()) as { previews?: Array<{ generated_voice_id: string; audio_base_64: string; media_type?: string; duration_secs?: number }>; text?: string };
    return c.json({
      data: {
        text: json.text ?? body.text ?? '',
        previews: (json.previews ?? []).map((p) => ({ generatedVoiceId: p.generated_voice_id, audioBase64: p.audio_base_64, mediaType: p.media_type ?? 'audio/mpeg', durationSecs: p.duration_secs ?? null })),
      },
    });
  },
);

/** `POST /voices/design/save` — keep one preview as a voice. 10 credits. */
const saveDesignSchema = z.object({
  generatedVoiceId: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(20).max(1000),
});

audioRoute.post(
  '/voices/design/save',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  zValidator('json', saveDesignSchema),
  async (c) => {
    const apiKey = c.env.ELEVENLABS_API_KEY;
    if (!apiKey) return c.json({ error: { code: 'audio_not_configured', message: 'Voices are not available right now.' } }, 503);
    const quota = await voiceQuotaFor(c, apiKey, true);
    if (quota.blocked) {
      const g = GATE_MESSAGES[quota.blocked];
      return c.json({ error: { code: `voice_${quota.blocked}`, message: g.message } }, g.status);
    }
    const user = c.var.user!;
    if (user.creditsBalance < VOICE_DESIGN_CREDITS) {
      return c.json({ error: { code: 'insufficient_credits', message: `Saving a designed voice costs ${VOICE_DESIGN_CREDITS} credits.` } }, 402);
    }
    const body = c.req.valid('json');
    const res = await fetch(`${BASE}/v1/text-to-voice`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ voice_name: body.name, voice_description: body.description, generated_voice_id: body.generatedVoiceId }),
    });
    if (!res.ok) {
      const message = await elevenError(res);
      console.error('[audio] design save failed:', res.status, message);
      return c.json({ error: { code: 'design_failed', message: message || 'Could not save that voice.' } }, 502);
    }
    const created = (await res.json()) as { voice_id: string; preview_url?: string | null };
    return finishVoice(c, apiKey, { voiceId: created.voice_id, name: body.name, description: body.description, origin: 'designed', credits: VOICE_DESIGN_CREDITS, consent: false, pending: false, previewUrl: created.preview_url ?? null });
  },
);

/** `DELETE /voices/:id` — our row id. Frees the account slot. */
audioRoute.delete(
  '/voices/:id',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  async (c) => {
    const apiKey = c.env.ELEVENLABS_API_KEY;
    if (!apiKey) return c.json({ error: { code: 'audio_not_configured', message: 'Voices are not available right now.' } }, 503);
    const user = c.var.user!;
    const id = c.req.param('id');
    const row = await c.var.db.query.userVoices.findFirst({ where: and(eq(userVoices.id, id), eq(userVoices.userId, user.id)) });
    if (!row) return c.json({ error: { code: 'not_found', message: 'Voice not found.' } }, 404);
    if (row.status !== 'deleted') {
      try {
        await elevenDeleteVoice(apiKey, row.elevenlabsVoiceId);
      } catch (err) {
        console.error('[audio] delete voice failed:', err instanceof Error ? err.message : err);
        return c.json({ error: { code: 'delete_failed', message: 'Could not delete the voice right now.' } }, 502);
      }
      await c.var.db.update(userVoices).set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() }).where(eq(userVoices.id, id));
      invalidateVoiceCache();
      slotsCache = null;
    }
    return c.json({ data: { ok: true } });
  },
);
