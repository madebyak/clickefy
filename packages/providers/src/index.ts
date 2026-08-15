/**
 * `@clickfy/providers` — capability registry + prompt compiler.
 *
 * Pure, side-effect-free package shared between:
 *   - the Cloudflare Worker (admin playground)
 *   - Trigger.dev tasks (production mobile generation)
 *   - the admin Next.js app (model-aware UI controls)
 *
 * Runtime adapters that actually fire HTTP calls to Gemini / Kling /
 * OpenAI live alongside this file (one per provider) and will be added
 * when we wire them up. Everything here is testable without network
 * or SDK mocks.
 */

export {
  MODEL_CAPABILITIES,
  findCapabilities,
  getCapabilities,
  listActiveModels,
  type ModelCapabilities,
  type ModelKind,
  type ModelStatus,
  type RefAddressingStyle,
  type SizingMode,
} from './capabilities';

export { compile } from './compile';

export {
  buildCreateStage,
  createReferenceKey,
  CREATE_PROMPT_KEY,
  CREATE_START_FRAME_KEY,
  CREATE_END_FRAME_KEY,
  type BuildCreateStageInput,
  type BuiltCreateStage,
} from './create-stage';

export type {
  CompileContext,
  CompileResult,
  CompileWarning,
  CompiledRequest,
  GeminiCompiledRequest,
  GeminiContentPart,
  GptImageCompiledRequest,
  ImagePart,
  KlingCompiledRequest,
  RuntimeInputValue,
  SeedanceCompiledRequest,
  StageOutputRef,
} from './compile-types';

export {
  executeStage,
  pollAsyncTask,
  type ExecuteOutput,
  type ExecuteResult,
  type ProviderEnv,
} from './execute';

export { executeGemini, type GeminiEnv } from './adapters/gemini';
export {
  executeKling,
  pollKling,
  type KlingEnv,
  type KlingPollVariant,
} from './adapters/kling';
export {
  executeSeedance,
  pollSeedance,
  type SeedanceEnv,
} from './adapters/seedance';
export {
  executeOpenAI,
  type OpenAIEnv,
  type OpenAIResult,
} from './adapters/openai';
export {
  executeSeedream,
  type SeedreamEnv,
  type SeedreamResult,
} from './adapters/seedream';
