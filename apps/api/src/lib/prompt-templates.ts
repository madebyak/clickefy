/**
 * Hidden prompts the admin may edit. The current text is read from
 * `prompt_templates` with a short per-isolate cache; no row means the
 * code default. Saving writes the row and a version.
 */

import { desc, eq } from 'drizzle-orm';

import { promptTemplateVersions, promptTemplates, type Db } from '@clickfy/db';
import { AD_BRIEF_DEFAULT, AD_BRIEF_PLACEHOLDERS, AD_MAX_BRIEF_CHARS } from '@clickfy/providers';

export const PROMPT_KEYS = ['ad_brief'] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export const PROMPT_DEFS: Record<PromptKey, { title: string; description: string; default: string; maxChars: number; placeholders: ReadonlyArray<{ token: string; meaning: string }> }> = {
  ad_brief: {
    title: 'One-Click Ad — director brief',
    description:
      'Sent to the vision model with the product images. Its reply must be one Seedance prompt in a code block; the user never sees either. The user\'s note, when given, is appended automatically as "Important Note".',
    default: AD_BRIEF_DEFAULT,
    maxChars: AD_MAX_BRIEF_CHARS,
    placeholders: AD_BRIEF_PLACEHOLDERS,
  },
};

const TTL_MS = 60_000;
const cache = new Map<PromptKey, { at: number; body: string | null }>();

/** The saved text, or null for "use the default". Cached a minute per isolate. */
export async function getPromptOverride(db: Db, key: PromptKey): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.body;
  const row = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.key, key), columns: { body: true } });
  const body = row?.body ?? null;
  cache.set(key, { at: Date.now(), body });
  return body;
}

export function invalidatePromptCache(key: PromptKey): void {
  cache.delete(key);
}

export async function savePrompt(db: Db, key: PromptKey, body: string, adminId: string | null, note: string | null): Promise<void> {
  await db
    .insert(promptTemplates)
    .values({ key, body, updatedByAdminId: adminId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: promptTemplates.key, set: { body, updatedByAdminId: adminId, updatedAt: new Date() } });
  await db.insert(promptTemplateVersions).values({ key, body, note, createdByAdminId: adminId });
  invalidatePromptCache(key);
}

export async function resetPrompt(db: Db, key: PromptKey, adminId: string | null): Promise<void> {
  await db.delete(promptTemplates).where(eq(promptTemplates.key, key));
  await db.insert(promptTemplateVersions).values({ key, body: PROMPT_DEFS[key].default, note: 'reset to default', createdByAdminId: adminId });
  invalidatePromptCache(key);
}

export async function listPromptVersions(db: Db, key: PromptKey, limit = 30) {
  return db.query.promptTemplateVersions.findMany({
    where: eq(promptTemplateVersions.key, key),
    orderBy: [desc(promptTemplateVersions.createdAt)],
    limit,
  });
}
