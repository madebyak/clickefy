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
  executeKlingApi2,
  pollKlingApi2,
  type KlingApi2Env,
} from './adapters/kling-api2';
import {
  executeSeedance,
  pollSeedance,
  type SeedanceEnv,
} from './adapters/seedance';
import { executeSeedream } from './adapters/seedream';
import { executeOpenAI, type OpenAIEnv } from './adapters/openai';

export interface ProviderEnv {
  gemini?: GeminiEnv;
  kling?: KlingEnv;
  /** Kling API 2.0 — a console-issued key, separate from the AK/SK pair. */
  klingApi2?: KlingApi2Env;
  seedance?: SeedanceEnv;
  openai?: OpenAIEnv;
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
      /** Poll via the API 2.0 client (`GET /tasks`) rather than legacy. */
      api2?: boolean;
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
    if (request.api2) {
      if (!env.klingApi2) {
        throw new Error(
          'executeStage(): missing `env.klingApi2` for a Kling API 2.0 request. This host needs a console-issued API key (KLING_API_KEY); the legacy access/secret pair is rejected.',
        );
      }
      return executeKlingApi2(request, env.klingApi2);
    }
    if (!env.kling) {
      throw new Error('executeStage(): missing `env.kling` for a Kling request.');
    }
    return executeKling(request, env.kling);
  }
  if (request.provider === 'openai') {
    if (!env.openai) {
      throw new Error('executeStage(): missing `env.openai` for an OpenAI request.');
    }
    return executeOpenAI(request, env.openai);
  }
  if (request.provider === 'seedance') {
    if (!env.seedance) {
      throw new Error('executeStage(): missing `env.seedance` for a Seedance request.');
    }
    // Seedream (image) and Seedance (video) share the provider tag, the
    // host and the key — but Seedream is synchronous, so it returns
    // `completed` directly instead of a task to poll.
    if ('variant' in request && request.variant === 'image') {
      return executeSeedream(request, env.seedance);
    }
    return executeSeedance(request, env.seedance);
  }
  // Exhaustive: every arm of CompiledRequest is handled above, so this
  // is `never`. Adding a provider to the union without an arm here turns
  // this assignment into a compile error rather than a runtime surprise.
  const unhandled: never = request;
  throw new Error(
    `executeStage(): no adapter for provider "${(unhandled as CompiledRequest).provider}". Add one in packages/providers/src/adapters/.`,
  );
}

/**
 * Poll an async task previously started by {@link executeStage}.
 *
 * For legacy Kling, the `variant` arg picks between the image2video and
 * omni-video poll endpoints. Kling API 2.0 has a single `GET /tasks`
 * for every variant, so `api2` short-circuits that choice. For Seedance,
 * `variant` is ignored (there's only one polling endpoint).
 *
 * `api2` is passed rather than persisted because polling happens in the
 * same worker invocation that created the task — the caller still holds
 * the `ExecuteResult` that carries it.
 */
export async function pollAsyncTask(
  taskId: string,
  provider: 'kling' | 'seedance',
  variant: KlingPollVariant,
  env: ProviderEnv,
  api2?: boolean,
): Promise<ExecuteResult> {
  if (provider === 'kling') {
    if (api2) {
      if (!env.klingApi2) {
        throw new Error('pollAsyncTask(): missing `env.klingApi2` for an API 2.0 task.');
      }
      return pollKlingApi2(taskId, env.klingApi2);
    }
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
