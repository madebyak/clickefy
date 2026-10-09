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
  references: Array<{ role: 'start_frame' | 'end_frame' | 'reference'; url: string }>;
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

  // Every image the user supplied, in the order the model saw it.
  const refs: AssetGeneration['references'] = [];
  const pushRef = (key: string, role: 'start_frame' | 'end_frame' | 'reference') => {
    const v = inputs[key];
    if (v && (v.kind === 'image' || v.kind === 'video') && v.r2Key) {
      refs.push({ role, url: assetUrl(origin, v.r2Key) });
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
  };
}
