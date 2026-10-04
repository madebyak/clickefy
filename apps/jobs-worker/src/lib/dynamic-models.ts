/**
 * The worker's copy of the dynamic-model loader.
 *
 * Same rows, same registry call as the API's `lib/dynamic-models.ts`,
 * checked structurally rather than with the API's Zod schema (the admin
 * screen already validated the row on write; the worker only needs to
 * be sure the fields the compiler reads exist). Called once per job, at
 * the top of `generate-job`, so a model enabled a moment ago runs on the
 * next job without a deploy.
 */

import { eq } from 'drizzle-orm';

import { providerModels } from '@clickfy/db';
import { isFalSpec, registerDynamicCapabilities, type ModelCapabilities } from '@clickfy/providers';

import { getDb } from './db';

function looksLikeCapabilities(v: Record<string, unknown>): boolean {
  return (
    v.provider === 'fal' &&
    (v.kind === 'image' || v.kind === 'video') &&
    typeof v.sizing === 'object' &&
    v.sizing !== null &&
    typeof v.outputs === 'object' &&
    v.outputs !== null &&
    isFalSpec(v.fal)
  );
}

export async function loadDynamicModels(): Promise<number> {
  const rows = await getDb()
    .select({
      modelKey: providerModels.modelKey,
      displayName: providerModels.displayName,
      status: providerModels.status,
      capabilities: providerModels.capabilities,
    })
    .from(providerModels)
    .where(eq(providerModels.provider, 'fal'));

  const caps: ModelCapabilities[] = [];
  for (const row of rows) {
    const c = row.capabilities as Record<string, unknown> | null;
    if (!c || !('fal' in c) || !looksLikeCapabilities(c)) continue;
    caps.push({
      ...(c as unknown as ModelCapabilities),
      modelKey: row.modelKey,
      displayName: row.displayName,
      status: row.status,
      refAddressing: (c.refAddressing as ModelCapabilities['refAddressing']) ?? 'ordinal',
    });
  }
  registerDynamicCapabilities(caps);
  return caps.length;
}
