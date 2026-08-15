/**
 * `buildCreateStage()` — synthesize a single `GenerationStage` for the
 * user-driven "create from scratch" flow (no template).
 *
 * The template pipeline loads its stages from a frozen template-version
 * snapshot. The create flow has no template, so we build an equivalent
 * stage in code from the user's raw prompt + chosen model + optional
 * attachments + aspect ratio + duration. The output plugs straight into
 * the SAME `compile()` → `executeStage()` engine the worker already runs
 * for templates — no new provider code.
 *
 * Attachments always travel through the job's `inputs` map (keyed by the
 * canonical field keys below) so the worker's `resolveJobInputs()`
 * hydrates their bytes from R2 — the one code path proven to feed the
 * adapters. That constrains what each provider can express here:
 *
 *   - Gemini (image): every attachment is a "subject" image, collected
 *     by the compiler in field order (up to `maxImagesTotal`).
 *   - Kling (video): the first image input becomes the start frame
 *     (`subjects[0]`), the second the end frame (`subjects[1]`, only when
 *     the model's `maxSubjects >= 2` and `acceptsStartEndImage`).
 *   - Seedance (video): explicit slot bindings — `first_last_frame` mode
 *     binds start/end to `frameSlots`; `reference` mode binds N images to
 *     `referenceSlots`. BytePlus forbids mixing, so it's one or the other.
 *
 * NOT covered in v1: Kling Omni's dedicated multi-reference grid
 * (`stage.references` / `@image_N`). Those references are NOT
 * hydrated by `resolveJobInputs()` (they carry only an `r2Key`), so
 * wiring them needs a separate reference-hydration step. Kling Omni here
 * supports text-to-video plus start/end frame; multi-reference is a
 * documented fast-follow.
 */

import type {
  GenerationStage,
  Provider,
  SeedanceFrameSlots,
  SeedanceReferenceSlot,
  SeedanceStageConfig,
  TemplateInputField,
} from '@clickfy/types';

import { getCapabilities } from './capabilities';

/** Canonical `jobs.inputs` field keys the API writes and the worker reads. */
export const CREATE_PROMPT_KEY = 'prompt';
export const CREATE_START_FRAME_KEY = 'start_frame';
export const CREATE_END_FRAME_KEY = 'end_frame';
/** Reference image field key for index `i` (0-based). */
export function createReferenceKey(i: number): string {
  return `ref_${i}`;
}

export interface BuildCreateStageInput {
  modelKey: string;
  /** The user's raw prompt (already length-validated upstream). */
  prompt: string;
  /** Chosen aspect ratio; omitted → the model's default frame. */
  aspectRatio?: string;
  /** Video duration in seconds; ignored for image models. */
  duration?: number;
  /** Native audio toggle (sound-capable models only; compiler gates it). */
  sound?: boolean;
  /** Quality tier for models with selectable modes (Kling std/pro/4k). */
  mode?: 'std' | 'pro' | '4k';
  /** Whether a start-frame image was attached (present in `inputs`). */
  hasStartFrame?: boolean;
  /** Whether an end-frame image was attached. */
  hasEndFrame?: boolean;
  /** Number of reference images attached (keys `ref_0..ref_{n-1}`). */
  referenceCount?: number;
}

export interface BuiltCreateStage {
  provider: Provider;
  stage: GenerationStage;
  /** Synthetic input-field definitions the compiler pairs with `inputValues`. */
  templateInputs: TemplateInputField[];
}

/**
 * Build the stage + synthetic input fields for a create job. Throws via
 * `getCapabilities` if `modelKey` is not in the registry (callers should
 * validate eligibility before reaching here).
 */
export function buildCreateStage(input: BuildCreateStageInput): BuiltCreateStage {
  const caps = getCapabilities(input.modelKey);
  const provider = caps.provider;
  const isImage = caps.kind === 'image';
  const refCount = Math.max(0, input.referenceCount ?? 0);

  // ── Synthetic image input fields ───────────────────────────────────
  // Order matters for subject-based providers (Gemini/Kling): the
  // compiler walks `templateInputs` in order, so start frame must precede
  // end frame. Seedance ignores order (it binds by fieldKey) but we keep
  // the same list for consistent labels.
  const templateInputs: TemplateInputField[] = [];
  let order = 0;
  const imageField = (fieldKey: string, label: string): TemplateInputField => ({
    id: fieldKey,
    fieldKey,
    label,
    required: false,
    order: order++,
    type: 'image',
  });

  if (input.hasStartFrame) templateInputs.push(imageField(CREATE_START_FRAME_KEY, 'Start frame'));
  if (input.hasEndFrame) templateInputs.push(imageField(CREATE_END_FRAME_KEY, 'End frame'));
  for (let i = 0; i < refCount; i++) {
    templateInputs.push(imageField(createReferenceKey(i), `Reference ${i + 1}`));
  }

  // ── Stage config (per provider) ────────────────────────────────────
  const config: Record<string, unknown> = {};
  // The compiler reads aspect from `stage.config.aspectRatio` for every
  // provider (Gemini/Kling/Seedance alike) and clamps it against the
  // model's allowed list, so it's safe to always set it when present.
  if (input.aspectRatio) config.aspectRatio = input.aspectRatio;

  if (provider === 'seedance') {
    const seedance = config as SeedanceStageConfig;
    if (typeof input.duration === 'number') seedance.duration = input.duration;
    if (refCount > 0) {
      // Reference mode — bind each image to a user_input slot.
      seedance.seedanceMode = 'reference';
      seedance.referenceSlots = Array.from(
        { length: refCount },
        (_, i): SeedanceReferenceSlot => ({
          id: createReferenceKey(i),
          assetKind: 'image',
          source: { kind: 'user_input', fieldKey: createReferenceKey(i) },
        }),
      );
    } else {
      // First/last frame mode — empty slots => text-to-video.
      seedance.seedanceMode = 'first_last_frame';
      const frameSlots: SeedanceFrameSlots = {};
      if (input.hasStartFrame) {
        frameSlots.firstFrame = { kind: 'user_input', fieldKey: CREATE_START_FRAME_KEY };
      }
      if (input.hasEndFrame) {
        frameSlots.lastFrame = { kind: 'user_input', fieldKey: CREATE_END_FRAME_KEY };
      }
      seedance.frameSlots = frameSlots;
    }
  } else {
    // Gemini + Kling.
    if (!isImage && typeof input.duration === 'number') config.duration = input.duration;
    // Native audio — the compiler drops it (with a warning) on models
    // without `supportsSound`, so setting it here is always safe.
    if (!isImage && input.sound) config.sound = true;
    // Quality tier — the user was charged for this exact tier upstream,
    // so it must reach the compiler for images (Gemini resolution, GPT
    // Image quality) as well as video (Kling mode).
    if (input.mode) config.mode = input.mode;
    if (isImage) config.numberOfOutputs = 1;
  }

  const stage: GenerationStage = {
    id: 'create',
    order: 0,
    provider,
    model: input.modelKey,
    prompt: input.prompt,
    // Admin reference images are template-only. User attachments travel
    // as subjects/slots via `inputs`, never here.
    references: [],
    config,
    retry: { enabled: false, maxAttempts: 1 },
  };

  return { provider, stage, templateInputs };
}
