/**
 * Type contracts for the prompt-compiler.
 *
 * The compiler takes a stage definition plus runtime context (the
 * user's uploaded inputs, the outputs of prior stages, the model's
 * capabilities) and produces a discriminated `CompiledRequest` ready
 * for a provider adapter to fire over HTTP.
 *
 * Keeping the output of `compile()` provider-shaped (rather than a
 * generic blob) means:
 *   - The Cloudflare Worker playground and Trigger.dev mobile pipeline
 *     can both `compile()` then call the same `executeStage()`. Same
 *     code path → no drift between admin tests and production jobs.
 *   - The unit tests can assert on the exact shape we'd send to each
 *     provider without spinning up a network mock.
 */

import type {
  GenerationStage,
  TemplateInputField,
} from '@clickfy/types';

import type { ModelCapabilities } from './capabilities';

// ─── Runtime input values (per template run) ────────────────────────

/**
 * A value the user (or playground tester) submitted for a single
 * `TemplateInputField`. Discriminated by the originating field type
 * (`text` | `image` | `video`) — text comes through as a string,
 * binary inputs come through with both a reference (`r2Key`) and an
 * optional inline `bytes` payload for cases where the executor wants
 * to ship the raw image to the provider (Gemini inline data).
 */
export type RuntimeInputValue =
  | { kind: 'text'; value: string }
  | {
      kind: 'image' | 'video';
      r2Key: string;
      mimeType: string;
      /** Optional inline binary — set when the executor has already loaded the bytes. */
      bytes?: Uint8Array;
      /** Optional fully-resolved URL (useful for providers that fetch by URL). */
      url?: string;
    };

/** A stage's binary output, passed forward as input for the next stage. */
export interface StageOutputRef {
  /** 1-indexed position of the producing stage. */
  stageIndex: number;
  kind: 'image' | 'video';
  /** R2 pointer once the executor has persisted the output. */
  r2Key?: string;
  /** Inline binary if the executor is chaining stages in-memory. */
  bytes?: Uint8Array;
  mimeType: string;
  url?: string;
}

// ─── Compiler input ─────────────────────────────────────────────────

/**
 * Everything `compile()` needs to produce a `CompiledRequest`. Pure,
 * serialisable, no SDK / fetch dependencies — so the function can be
 * tested without mocking anything.
 */
export interface CompileContext {
  stage: GenerationStage;
  /** The template's own input-field definitions (for label / order lookups). */
  templateInputs: TemplateInputField[];
  /** User-submitted values keyed by `fieldKey`. Missing keys are tolerated. */
  inputValues: Record<string, RuntimeInputValue>;
  /** Outputs of every prior stage in the same run (in execution order). */
  previousOutputs: StageOutputRef[];
  /** Capabilities of `stage.model` — produced by `getCapabilities()`. */
  capabilities: ModelCapabilities;
}

// ─── Compiler output (discriminated by provider/variant) ────────────

/** Image part the executor will turn into provider-specific payloads. */
export interface ImagePart {
  /** 1-indexed position in the model's input sequence. Drives ordinal labels. */
  index: number;
  /** Where the image is being referenced from. Drives label preamble text. */
  role:
    | 'reference'
    | 'subject'
    | 'stage-output';
  /**
   * Canonical role tag — uppercased and used verbatim in provider
   * preambles ("STYLE REFERENCE", "USER INPUT", "CONTINUATION"). Kept
   * distinct from `displayLabel` so admin-supplied freeform labels
   * can never displace the role keyword the model classifies on.
   */
  roleTag: string;
  /**
   * Admin-supplied freeform label shown alongside the role tag. May
   * be empty. Examples: a reference image's `label` field, a user
   * input field's `label`, or "Stage N output".
   */
  displayLabel: string;
  mimeType: string;
  bytes?: Uint8Array;
  r2Key?: string;
  url?: string;
}

/**
 * One element of the Gemini `contents[]` array. Mirrors the SDK shape
 * 1:1 so the adapter can hand it straight to `generateContent`.
 */
export type GeminiContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string /* base64 */ } };

export interface GeminiCompiledRequest {
  provider: 'gemini';
  /** Which call shape to invoke — `generateContent` (multimodal) vs `generateImages` (Imagen). */
  variant: 'generateContent' | 'generateImages';
  model: string;
  /** Final prompt text (after `{{input:text}}` substitutions). */
  prompt: string;
  /**
   * The fully-built contents array for `generateContent`. Empty for
   * Imagen (`generateImages` only takes a prompt string + config).
   */
  contents: GeminiContentPart[];
  /** Maps directly to `config.imageConfig` on the SDK. */
  imageConfig?: {
    aspectRatio?: string;
    imageSize?: string;
  };
  /** Number of images to return (drives `config.numberOfImages` for Imagen). */
  numberOfOutputs: number;
  /** Always includes `'IMAGE'`; `'TEXT'` is on for thinking-mode commentary. */
  responseModalities: ('TEXT' | 'IMAGE')[];
  /**
   * Original image parts (refs + subjects + stage outputs) for
   * observability / debugging. The compiled `contents` array already
   * encodes them in the right order; this field is informational.
   */
  imageParts: ImagePart[];
}

export interface KlingCompiledRequest {
  provider: 'kling';
  /**
   * Which Kling endpoint shape to invoke:
   *   - `text2video`  for prompt-only runs on t2v-capable models (v3).
   *   - `image2video` for the v2 family (single `image` field).
   *   - `omni`        for v3 Omni (`reference_images[]` + start/end).
   */
  variant: 'text2video' | 'image2video' | 'omni';
  model: string;
  /** Final prompt — for Omni, contains `<<<image_N>>>` references. */
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  /** Video length in seconds. */
  duration?: number;
  /** Quality tier: std (720p) / pro (1080p) / 4k (`standard` = legacy alias for std). */
  mode?: 'standard' | 'pro' | 'std' | '4k';
  cfgScale?: number;
  /** Native audio generation (Kling v3 Omni `sound: on|off`). */
  soundEnabled?: boolean;
  /** First frame of the resulting video. */
  startImage?: ImagePart;
  /** Optional last frame. */
  endImage?: ImagePart;
  /** Admin-uploaded references (Omni only). */
  referenceImages?: ImagePart[];
}

/**
 * Compiled request for BytePlus Seedance 2.0.
 *
 * The wire format on the adapter side is the BytePlus ModelArk shape:
 * a single `content[]` array where every element is either a text part
 * (`{ type: 'text', text }`) or a media part
 * (`{ type: 'image_url', image_url: { url }, role? }`). The compiler
 * keeps the prompt and media parts on separate fields here so the
 * adapter retains the flexibility to build either flavour (it picks
 * `role` per part based on `role` + position) without re-parsing.
 *
 * `seedance` always returns ONE video per task (BytePlus enforces this
 * — multi-output requires submitting N separate tasks). The runtime
 * type therefore omits a `numberOfOutputs` field.
 */
export interface SeedanceCompiledRequest {
  provider: 'seedance';
  model: string;
  /** Final prompt — Seedance natural-language image addressing is fine. */
  prompt: string;
  /**
   * Aspect ratio. Pass `'adaptive'` to let Seedance match the first
   * image's aspect (useful for I2V flows where the input drives shape).
   */
  ratio?: string;
  /** Video length in seconds. 5 or 10 today; the API accepts 4–15. */
  duration?: number;
  /** Output resolution. */
  resolution?: '480p' | '720p' | '1080p' | '2K';
  /** Generate native audio (sfx, ambient, lip-sync if a face is present). */
  generateAudio?: boolean;
  /** Return the final video frame as a still in the result payload. */
  returnLastFrame?: boolean;
  /** Hold the camera fixed (no automatic pan/zoom). */
  cameraFixed?: boolean;
  /** Reproducibility seed. */
  seed?: number;
  /** Negative prompt to discourage certain content. */
  negativePrompt?: string;
  /** First frame of the resulting video (I2V / bookend). */
  startImage?: ImagePart;
  /** Last frame (bookend control). */
  endImage?: ImagePart;
  /** Admin-uploaded references (style / composition / scene cues). */
  referenceImages?: ImagePart[];
}

/** Stub for the forthcoming OpenAI provider. */
export interface GptImageCompiledRequest {
  provider: 'openai';
  variant: 'image-generate' | 'image-edit';
  model: string;
  prompt: string;
  /** Either a preset (`1024x1024`) or `WIDTHxHEIGHT`. */
  size: string;
  quality: 'low' | 'medium' | 'high';
  numberOfOutputs: number;
  imageParts: ImagePart[];
}

export type CompiledRequest =
  | GeminiCompiledRequest
  | KlingCompiledRequest
  | SeedanceCompiledRequest
  | SeedreamCompiledRequest
  | GptImageCompiledRequest;

/**
 * Seedream — BytePlus ModelArk's IMAGE line.
 *
 * Shares the `seedance` provider tag because it is the same vendor, the
 * same host and the same API key; only the path differs. Crucially it is
 * **synchronous** (`POST /images/generations` returns the images inline)
 * where Seedance video is a submit-then-poll task, so this never produces
 * a `pending` ExecuteResult.
 *
 * Discriminated from the video arm by `variant: 'image'`.
 */
export interface SeedreamCompiledRequest {
  provider: 'seedance';
  variant: 'image';
  model: string;
  prompt: string;
  /**
   * Either a resolution keyword (`1K`/`2K`/`4K`…) or an explicit
   * `WIDTHxHEIGHT`. The API treats these as mutually exclusive, so this
   * is one field rather than two.
   *
   * Note 4.5 and 5.0-lite reject anything under ~3.69 MP, so a bare
   * `1024x1024` is an error on those models — the compiler resolves a
   * keyword the model actually supports instead of passing pixels through.
   */
  size?: string;
  /** 5.0 pro and 5.0 lite only; 4.x is jpeg-only. */
  outputFormat?: 'png' | 'jpeg';
  /**
   * The API defaults this to TRUE and stamps an "AI generated" mark on the
   * output, so we always send it explicitly.
   */
  watermark: boolean;
  /**
   * Multi-image generation. Seedream has no `n`: with `'auto'` the model
   * decides how many images the prompt implies, capped by `maxImages`.
   * Unsupported on 5.0 pro.
   */
  sequentialImageGeneration?: 'auto' | 'disabled';
  /** 1–15, and inputs + outputs must together stay ≤ 15. */
  maxImages?: number;
  /** Reference / edit inputs. Empty ⇒ pure text-to-image. */
  images?: ImagePart[];
}

// ─── Compile-time warnings ──────────────────────────────────────────

/**
 * Non-fatal issues the compiler surfaces alongside the request. Used
 * by the admin form to show validation warnings ("you referenced
 * `{{ref:foo}}` but no such reference exists") without blocking
 * execution — the API layer may also choose to upgrade certain
 * warnings to 400-level errors.
 */
export interface CompileWarning {
  code:
    | 'unknown_variable'
    | 'unused_reference'
    | 'unused_input'
    | 'reference_dropped' // e.g. Imagen, which ignores all images
    | 'subject_dropped'
    | 'stage_output_missing'
    | 'config_clamped'
    | 'deprecated_syntax'; // bare `{{key}}` without `input:` / `ref:` prefix
  message: string;
  /** The token that triggered the warning, if applicable. */
  token?: string;
}

export interface CompileResult {
  request: CompiledRequest;
  warnings: CompileWarning[];
}
