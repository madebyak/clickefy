/**
 * `executeStage()` — dispatch a `CompiledRequest` to the right
 * provider adapter and return a normalised `ExecuteResult`. This is
 * the single entry point the admin playground and the Trigger.dev
 * production runner both call. Same compiler + same dispatcher → no
 * drift between local tests and mobile-triggered jobs.
 *
 * Provider credentials are passed in via the `env` arg rather than
 * read from globals, so the same code path serves the Next.js admin
 * route (`process.env`), a Cloudflare Worker (`c.env`), and a
 * Trigger.dev task (`process.env`).
 */

import type { CompiledRequest } from './compile-types';
import { executeGemini, type GeminiEnv } from './adapters/gemini';
import {
  executeKling,
  pollKling,
  type KlingEnv,
  type KlingPollVariant,
} from './adapters/kling';
import {
  executeSeedance,
  pollSeedance,
  type SeedanceEnv,
} from './adapters/seedance';

export interface ProviderEnv {
  gemini?: GeminiEnv;
  kling?: KlingEnv;
  seedance?: SeedanceEnv;
}

/** A single output piece returned by an adapter. */
export interface ExecuteOutput {
  type: 'image' | 'video';
  /** Inline base64 image data (Gemini path). */
  base64?: string;
  mimeType?: string;
  /** Hosted asset URL (Kling / Seedance video, Cloudflare Stream once wired). */
  url?: string;
  durationSec?: number;
}

export type ExecuteResult =
  | { status: 'completed'; outputs: ExecuteOutput[] }
  | {
      status: 'pending';
      taskId: string;
      provider: 'kling';
      /**
       * Kling routes async work to one of several endpoints. The poll
       * URL differs per variant (`/v1/videos/image2video/{id}` vs
       * `/v1/videos/omni-video/{id}`) so we carry the discriminator
       * forward; the playground passes it back as a query param.
       */
      variant: 'text2video' | 'image2video' | 'omni';
    }
  | {
      status: 'pending';
      taskId: string;
      provider: 'seedance';
    };

/**
 * Run a single compiled stage. Synchronous-completing providers
 * (Gemini, Imagen) return `{ status: 'completed', outputs }`
 * directly; async providers (Kling, Seedance) return a `taskId` the
 * caller polls via {@link pollAsyncTask}.
 */
export async function executeStage(
  request: CompiledRequest,
  env: ProviderEnv,
): Promise<ExecuteResult> {
  if (request.provider === 'gemini') {
    if (!env.gemini) {
      throw new Error('executeStage(): missing `env.gemini` for a Gemini request.');
    }
    return executeGemini(request, env.gemini);
  }
  if (request.provider === 'kling') {
    if (!env.kling) {
      throw new Error('executeStage(): missing `env.kling` for a Kling request.');
    }
    return executeKling(request, env.kling);
  }
  if (request.provider === 'seedance') {
    if (!env.seedance) {
      throw new Error('executeStage(): missing `env.seedance` for a Seedance request.');
    }
    return executeSeedance(request, env.seedance);
  }
  throw new Error(
    `executeStage(): no adapter for provider "${request.provider}". Add one in packages/providers/src/adapters/.`,
  );
}

/**
 * Poll an async task previously started by {@link executeStage}.
 *
 * For Kling, the `variant` arg picks between the image2video and
 * omni-video poll endpoints. For Seedance, `variant` is ignored
 * (there's only one polling endpoint).
 */
export async function pollAsyncTask(
  taskId: string,
  provider: 'kling' | 'seedance',
  variant: KlingPollVariant,
  env: ProviderEnv,
): Promise<ExecuteResult> {
  if (provider === 'kling') {
    if (!env.kling) {
      throw new Error('pollAsyncTask(): missing `env.kling`.');
    }
    return pollKling(taskId, variant, env.kling);
  }
  if (provider === 'seedance') {
    if (!env.seedance) {
      throw new Error('pollAsyncTask(): missing `env.seedance`.');
    }
    return pollSeedance(taskId, env.seedance);
  }
  throw new Error(`pollAsyncTask(): unsupported provider "${provider}".`);
}
