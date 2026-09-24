/**
 * Seedance Draft mode — the server side of "make the final video".
 *
 * A draft is an ordinary create job submitted with `draft: true`: the
 * provider renders a cheap preview at the model's draft tier, and the
 * worker keeps the provider's task id on `jobs.result.providerTaskId`.
 * The final is a SECOND create job carrying that id. BytePlus reuses the
 * draft's prompt, media, ratio, duration and audio setting and serves the
 * final at `caps.draft.finalTier` only, so the final's price follows from
 * the draft's own settings at that tier — which is why the draft job
 * records every term of its charge on `options`.
 *
 * Both the create route (the charge) and the project assets list (the
 * figure on the tile's "Make final" action) price through
 * `draftFinalCost` (in `@clickfy/providers`, where it is tested), so the
 * two cannot disagree.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';

import { jobs, providerModels, type Db } from '@clickfy/db';
import {
  CREATE_PROMPT_KEY,
  draftFinalCost,
  findCapabilities,
  type DraftJobOptions,
  type ModelCapabilities,
} from '@clickfy/providers';
import type { JobInputValue, JobResult } from '@clickfy/types';

/**
 * Stop offering a final this long before the provider's own expiry. The
 * clock BytePlus runs from is the task's creation, which is a little
 * AFTER our job row's; the margin also covers a final that sits queued
 * for a while before the worker submits it.
 */
const EXPIRY_MARGIN_MS = 60 * 60 * 1000;

/** When a draft can no longer be turned into a final. */
export function draftExpiresAt(createdAt: Date, validDays: number): Date {
  return new Date(createdAt.getTime() + validDays * 24 * 60 * 60 * 1000 - EXPIRY_MARGIN_MS);
}

/** What an asset list tells a draft tile — see `StudioAsset.draft` in the SDK. */
export interface DraftAssetInfo {
  /** The model the final must be requested on — the draft's own. */
  modelKey: string;
  expiresAt: string;
  finalTier: string;
  finalCostCredits: number;
  /** The final already made (or being made) from this draft, if any. */
  finalJobId: string | null;
}

export function draftAssetInfo(args: {
  caps: ModelCapabilities;
  price: { costCredits: number; tierPricing: Record<string, number> | null };
  createdAt: Date;
  options: DraftJobOptions;
  finalJobId: string | null;
}): DraftAssetInfo | undefined {
  const { caps } = args;
  if (!caps.draft) return undefined;
  return {
    modelKey: caps.modelKey,
    expiresAt: draftExpiresAt(args.createdAt, caps.draft.validDays).toISOString(),
    finalTier: caps.draft.finalTier,
    finalCostCredits: draftFinalCost(args),
    finalJobId: args.finalJobId,
  };
}

/**
 * `draftAssetInfo` for a page of draft assets, keyed by asset id. One
 * price lookup per model on the page, not per tile.
 */
export async function draftAssetInfos(
  db: Db,
  drafts: ReadonlyArray<{
    assetId: string;
    modelKey: string;
    createdAt: Date;
    options: DraftJobOptions;
    finalJobId: string | null;
  }>,
): Promise<Map<string, DraftAssetInfo>> {
  const out = new Map<string, DraftAssetInfo>();
  if (drafts.length === 0) return out;
  const modelKeys = [...new Set(drafts.map((d) => d.modelKey))];
  const priceRows = await db
    .select({
      modelKey: providerModels.modelKey,
      costCredits: providerModels.costCredits,
      tierPricing: providerModels.tierPricing,
    })
    .from(providerModels)
    .where(inArray(providerModels.modelKey, modelKeys));
  const prices = new Map(priceRows.map((r) => [r.modelKey, r]));
  for (const d of drafts) {
    const caps = findCapabilities(d.modelKey);
    const price = prices.get(d.modelKey);
    if (!caps || !price) continue;
    const info = draftAssetInfo({
      caps,
      price: { costCredits: price.costCredits, tierPricing: price.tierPricing ?? null },
      createdAt: d.createdAt,
      options: d.options,
      finalJobId: d.finalJobId,
    });
    if (info) out.set(d.assetId, info);
  }
  return out;
}

export interface DraftSource {
  jobId: string;
  providerTaskId: string;
  /** The draft's own prompt input, copied onto the final for its record. */
  promptInput: JobInputValue | undefined;
  options: DraftJobOptions;
}

type DraftLookupError = {
  status: 404 | 409 | 422;
  error: { code: string; message: string; details?: Record<string, unknown> };
};

/**
 * Load a draft the caller may turn into a final, or say why not.
 *
 * Scoped by owner (a foreign id is a 404, no existence leak), and refuses
 * a second final while one is queued, running or done — the final reuses
 * the draft's seed, so a repeat would charge again for the same video.
 */
export async function loadDraftForFinal(
  db: Db,
  args: { userId: string; draftJobId: string; modelKey: string; validDays: number; now?: Date },
): Promise<{ ok: DraftSource } | DraftLookupError> {
  const row = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, args.draftJobId), eq(jobs.userId, args.userId)),
    columns: {
      id: true,
      modelKey: true,
      status: true,
      options: true,
      inputs: true,
      result: true,
      createdAt: true,
    },
  });
  if (!row) {
    return { status: 404, error: { code: 'draft_not_found', message: 'Draft not found.' } };
  }
  const options = (row.options ?? {}) as DraftJobOptions;
  if (options.draft !== true || row.modelKey !== args.modelKey) {
    return {
      status: 422,
      error: { code: 'not_a_draft', message: 'That video is not a draft for this model.' },
    };
  }
  if (row.status !== 'completed') {
    return {
      status: 409,
      error: { code: 'draft_not_ready', message: 'The draft is still being generated.' },
    };
  }
  const providerTaskId = (row.result as JobResult | null)?.providerTaskId;
  if (!providerTaskId) {
    return {
      status: 422,
      error: { code: 'draft_unavailable', message: 'This draft cannot be turned into a final.' },
    };
  }
  if ((args.now ?? new Date()) >= draftExpiresAt(row.createdAt, args.validDays)) {
    return {
      status: 422,
      error: {
        code: 'draft_expired',
        message: `Drafts can be finalised for ${args.validDays} days. Generate a new draft.`,
      },
    };
  }

  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, args.userId),
        inArray(jobs.status, ['queued', 'processing', 'completed']),
        sql`${jobs.options}->>'fromDraftJobId' = ${row.id}`,
      ),
    )
    .limit(1);
  if (existing) {
    return {
      status: 409,
      error: {
        code: 'draft_already_finalized',
        message: 'A final has already been made from this draft.',
        details: { jobId: existing.id },
      },
    };
  }

  const inputs = (row.inputs ?? {}) as Record<string, JobInputValue>;
  return {
    ok: {
      jobId: row.id,
      providerTaskId,
      promptInput: inputs[CREATE_PROMPT_KEY],
      options,
    },
  };
}
