/**
 * Load database-driven fal models into the capability registry.
 *
 * Called from the `withDb` middleware, so every request that can look a
 * model up sees the same roster the admin panel last saved. The query is
 * tiny (a handful of rows) and cached per isolate for a minute; admin
 * writes call `invalidateDynamicModels()` so the next request re-reads.
 *
 * Rows that do not validate are skipped and logged, never thrown: the
 * picker losing one model is recoverable from the admin screen, the
 * whole API losing `/v1/models` is not.
 */

import { eq } from 'drizzle-orm';

import { providerModels } from '@clickfy/db';
import { registerDynamicCapabilities, type ModelCapabilities } from '@clickfy/providers';

import { falModelCapabilitiesSchema, toModelCapabilities } from './fal-model-schema';
import type { AppEnv } from '../types';

const TTL_MS = 60_000;
/**
 * The load is bounded so a slow database can never hold a request: the
 * registry simply keeps whatever it had and tries again next time.
 */
const LOAD_TIMEOUT_MS = 4_000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

export function invalidateDynamicModels(): void {
  loadedAt = 0;
}

/** True once a load has completed in this isolate (the registry is populated). */
export function dynamicModelsLoaded(): boolean {
  return loadedAt > 0;
}

export async function loadDynamicModels(db: AppEnv['Variables']['db'], force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const query = db
        .select({
          modelKey: providerModels.modelKey,
          displayName: providerModels.displayName,
          status: providerModels.status,
          capabilities: providerModels.capabilities,
        })
        .from(providerModels)
        .where(eq(providerModels.provider, 'fal'));
      const rows = await Promise.race([
        query,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`dynamic model load exceeded ${LOAD_TIMEOUT_MS}ms`)), LOAD_TIMEOUT_MS),
        ),
      ]);

      const caps: ModelCapabilities[] = [];
      for (const row of rows) {
        // Only rows that carry a spec are dynamic; the Video Upscaler's
        // row is a price record for a code-registry model and is skipped.
        if (!row.capabilities || typeof row.capabilities !== 'object' || !('fal' in row.capabilities)) continue;
        const parsed = falModelCapabilitiesSchema.safeParse({
          ...row.capabilities,
          // The row's columns are the truth for these three.
          modelKey: row.modelKey,
          displayName: row.displayName,
          status: row.status,
        });
        if (!parsed.success) {
          console.warn('[dynamic-models] skipping invalid fal model row', {
            modelKey: row.modelKey,
            issues: parsed.error.issues.slice(0, 5),
          });
          continue;
        }
        caps.push(toModelCapabilities(parsed.data));
      }
      registerDynamicCapabilities(caps);
      loadedAt = Date.now();
    } catch (err) {
      // Keep whatever was registered before; try again next request.
      console.error('[dynamic-models] load failed', err);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * For routes that read the registry (`/v1/models`, job submission, the
 * admin model screens): wait for the first load in this isolate, bounded
 * by the same timeout, then proceed with whatever is registered.
 */
export async function ensureDynamicModels(db: AppEnv['Variables']['db']): Promise<void> {
  if (dynamicModelsLoaded()) {
    // Refresh in the background when stale; serve what we have now.
    void loadDynamicModels(db).catch(() => undefined);
    return;
  }
  await loadDynamicModels(db).catch(() => undefined);
}
