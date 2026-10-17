/**
 * A job's generation setup, as the composer needs it to restore the run
 * — prompt, model, tier, ratio, duration, sound and every attachment in
 * the order the model saw them. Served on the asset-detail response
 * (Re-use) and on `GET /v1/jobs/:id/setup` (Edit & retry on a failed
 * run, which has no asset to hang the detail on).
 */

import { eq } from 'drizzle-orm';

import { templates, type Db } from '@clickfy/db';
import {
  CREATE_END_FRAME_KEY,
  CREATE_PROMPT_KEY,
  CREATE_START_FRAME_KEY,
  createReferenceKey,
  findCapabilities,
} from '@clickfy/providers';
import type { JobInputValue } from '@clickfy/types';

import { assetUrl } from './asset-url';

/** Provenance block on the asset-detail response — mirrors the SDK's `AssetGeneration`. */
export interface AssetGeneration {
  source: 'template' | 'user';
  /** User-typed prompt. Always null for template jobs — see below. */
  prompt: string | null;
  templateTitle: string | null;
  modelKey: string | null;
  modelName: string | null;
  aspectRatio: string | null;
  quality: string | null;
  duration: number | null;
  sound: boolean | null;
  /** Every attachment in the order the model saw it, each with its media kind. */
  references: Array<{ role: 'start_frame' | 'end_frame' | 'reference'; kind: 'image' | 'video' | 'audio'; url: string }>;
  /** What the job produced — tells the composer which mode to restore into. */
  kind: 'image' | 'video' | 'audio';
  /** Audio jobs only: the voice and settings the Audio composer needs to rebuild the run. */
  audio: AudioGenerationSetup | null;
}

export interface AudioGenerationSetup {
  task: 'tts' | 'sfx' | 'sts';
  voiceId: string | null;
  voiceName: string | null;
  publicOwnerId: string | null;
  engine: string | null;
  expressive: boolean | null;
  stability: number | null;
  similarity: number | null;
  speed: number | null;
  languageCode: string | null;
  durationSeconds: number | null;
  promptInfluence: number | null;
}

/** The composer sends at most this many references; nothing past it is read. */
const MAX_LISTED_REFERENCES = 16;

export interface SetupJobRow {
  source: 'template' | 'user';
  modelKey: string | null;
  inputs: unknown;
  options: unknown;
  templateId: string | null;
}

export async function generationSetupFor(
  db: Db,
  origin: string,
  job: SetupJobRow,
): Promise<AssetGeneration> {
  // `options` is wider on the wire than its column annotation: the
  // create flow also persists the resolved quality tier and the
  // sound toggle.
  const opts = (job.options ?? {}) as {
    aspectRatio?: string;
    duration?: number;
    sound?: boolean;
    mode?: string;
    tool?: { kind?: string };
    audio?: StoredAudioOptions;
  };
  const inputs = (job.inputs ?? {}) as Record<string, JobInputValue>;

  // Template prompts are ours, not the user's — surface the template
  // by name and withhold the prompt text itself.
  const isTemplate = job.source === 'template';
  let templateTitle: string | null = null;
  if (isTemplate && job.templateId) {
    const [tpl] = await db
      .select({ title: templates.title })
      .from(templates)
      .where(eq(templates.id, job.templateId))
      .limit(1);
    templateTitle = tpl?.title ?? null;
  }

  const promptInput = inputs[CREATE_PROMPT_KEY];
  const caps = job.modelKey ? findCapabilities(job.modelKey) : undefined;

  // Every attachment the user supplied, in the order the model saw it —
  // images and clips for the video models, the source recording for the
  // voice changer.
  const refs: AssetGeneration['references'] = [];
  const pushRef = (key: string, role: 'start_frame' | 'end_frame' | 'reference') => {
    const v = inputs[key];
    if (v && v.kind !== 'text' && v.r2Key) {
      refs.push({ role, kind: v.kind, url: assetUrl(origin, v.r2Key) });
    }
  };
  pushRef(CREATE_START_FRAME_KEY, 'start_frame');
  pushRef(CREATE_END_FRAME_KEY, 'end_frame');
  for (let i = 0; i < MAX_LISTED_REFERENCES; i += 1) {
    pushRef(createReferenceKey(i), 'reference');
  }

  return {
    source: job.source,
    // A One-Click Ad's prompt was written by a model, not the user:
    // withheld like a template's, so the info panel and Re-use skip it.
    prompt:
      !isTemplate && promptInput?.kind === 'text' && opts.tool?.kind !== 'ad'
        ? (promptInput.value ?? null)
        : null,
    templateTitle,
    modelKey: job.modelKey,
    modelName: caps?.displayName ?? job.modelKey,
    aspectRatio: opts.aspectRatio ?? null,
    quality: opts.mode ?? null,
    duration: opts.duration ?? null,
    sound: typeof opts.sound === 'boolean' ? opts.sound : null,
    references: refs,
    kind: caps?.kind === 'video' ? 'video' : caps?.kind === 'audio' ? 'audio' : 'image',
    audio: caps?.kind === 'audio' && caps.audio ? audioSetup(caps.audio.task, opts.audio ?? {}) : null,
  };
}

/** `options.audio` as the create route stores it (see `createAudioOptionsSchema`). */
interface StoredAudioOptions {
  voiceId?: string; voiceName?: string; publicOwnerId?: string; engine?: string; expressive?: boolean;
  stability?: number; similarity?: number; speed?: number; languageCode?: string;
  durationSeconds?: number; promptInfluence?: number;
}

function audioSetup(task: 'tts' | 'sfx' | 'sts', a: StoredAudioOptions): AudioGenerationSetup {
  return {
    task,
    voiceId: a.voiceId ?? null,
    voiceName: a.voiceName ?? null,
    publicOwnerId: a.publicOwnerId ?? null,
    engine: a.engine ?? null,
    expressive: typeof a.expressive === 'boolean' ? a.expressive : null,
    stability: typeof a.stability === 'number' ? a.stability : null,
    similarity: typeof a.similarity === 'number' ? a.similarity : null,
    speed: typeof a.speed === 'number' ? a.speed : null,
    languageCode: a.languageCode ?? null,
    durationSeconds: typeof a.durationSeconds === 'number' ? a.durationSeconds : null,
    promptInfluence: typeof a.promptInfluence === 'number' ? a.promptInfluence : null,
  };
}
