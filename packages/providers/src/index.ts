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
  aspectRatiosFor,
  findCapabilities,
  getCapabilities,
  listActiveModels,
  listDynamicModels,
  registerDynamicCapabilities,
  type ModelCapabilities,
  type ModelKind,
  type ModelStatus,
  type RefAddressingStyle,
  type SizingMode,
} from './capabilities';

export { compile, pixelSizeForAspect } from './compile';
export {
  AD_ASPECT_RATIO,
  AD_BRIEF_DEFAULT,
  AD_BRIEF_PLACEHOLDERS,
  AD_DURATION_SECONDS,
  AD_MAX_BRIEF_CHARS,
  AD_MAX_IMAGES,
  AD_MAX_NOTE_CHARS,
  AD_ORIENTATIONS,
  AD_SCRIPT_COST_USD,
  AD_SCRIPT_CREDITS,
  buildAdBrief,
  extractAdPrompt,
  type AdOrientation,
} from './ad-prompt';
export { executeElevenLabs, type ElevenLabsEnv, type ElevenLabsResult, type ElevenLabsUsage } from './adapters/elevenlabs';

export {
  failedStageCost,
  stageCost,
  summariseJobCost,
  type StageCost,
  type StageCostFacts,
} from './job-cost';

export {
  buildFalInput,
  isFalSpec,
  pickFalEndpoint,
  type FalEndpointSet,
  type FalInputMap,
  type FalResolvedRequest,
  type FalSpec,
  type FalTask,
} from './fal-spec';

export {
  buildCreateStage,
  createReferenceKey,
  CREATE_PROMPT_KEY,
  CREATE_START_FRAME_KEY,
  CREATE_END_FRAME_KEY,
  type BuildCreateStageInput,
  type BuiltCreateStage,
} from './create-stage';

export {
  composeToolPrompt,
  composeCameraAnglePrompt,
  composeCameraPresetPrompt,
  composeStoryboardPrompt,
  CAMERA_PRESETS,
  STORYBOARD_STYLES,
  TOOL_MODELS,
  type CameraPreset,
  type CreateToolRequest,
  type StoryboardStyle,
} from './tool-prompts';

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
  executeKlingApi2,
  pollKlingApi2,
  type KlingApi2Env,
} from './adapters/kling-api2';
export {
  executeKling,
  pollKling,
  type KlingEnv,
  type KlingPollVariant,
} from './adapters/kling';
export { ProviderTaskFailedError, isProviderTaskFailedError } from './provider-errors';
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
export { draftFinalCost, type DraftJobOptions } from './draft';
