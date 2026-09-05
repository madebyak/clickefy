/**
 * Zod schemas for `POST /v1/jobs`.
 *
 * The body mirrors the `JobInputValue` discriminated union in
 * `@clickfy/types/json-types.ts`, so what the client sends is exactly
 * what we persist into `jobs.inputs`. Per-template *content* validation
 * (e.g. "this select value isn't one of the template's options",
 * "this r2Key doesn't belong to you") lives in `job-validation.ts`
 * because it depends on the template row at runtime.
 */

import { z } from 'zod';

// Hard ceilings, sized to match the upload route's `USER_MAX_BYTES`
// (25MB) for images, with extra headroom for short video references.
const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
// BytePlus caps reference-audio clips at 15MB; enforcing the same here
// turns an over-size clip into a 400 instead of a failed-after-debit job.
const AUDIO_MAX_BYTES = 15 * 1024 * 1024;

const r2KeyShape = z.string().min(1).max(512);
const mimeShape = z.string().min(1).max(128);

const jobInputImageSchema = z.object({
  kind: z.literal('image'),
  r2Key: r2KeyShape,
  mimeType: mimeShape,
  sizeBytes: z.number().int().positive().max(IMAGE_MAX_BYTES),
});

const jobInputVideoSchema = z.object({
  kind: z.literal('video'),
  r2Key: r2KeyShape,
  mimeType: mimeShape,
  sizeBytes: z.number().int().positive().max(VIDEO_MAX_BYTES),
});

const jobInputAudioSchema = z.object({
  kind: z.literal('audio'),
  r2Key: r2KeyShape,
  mimeType: mimeShape,
  sizeBytes: z.number().int().positive().max(AUDIO_MAX_BYTES),
});

const jobInputTextSchema = z.object({
  kind: z.literal('text'),
  // Empty strings allowed for non-required fields the user left blank.
  // The required-presence check lives in `job-validation.ts`.
  value: z.string().max(10_000),
});

export const jobInputValueSchema = z.discriminatedUnion('kind', [
  jobInputImageSchema,
  jobInputVideoSchema,
  jobInputAudioSchema,
  jobInputTextSchema,
]);

/** A create-flow reference: image, or (Seedance) video / audio clip. */
export const createReferenceSchema = z.discriminatedUnion('kind', [
  jobInputImageSchema,
  jobInputVideoSchema,
  jobInputAudioSchema,
]);

export const createJobSchema = z.object({
  templateId: z.string().uuid(),
  inputs: z.record(z.string().min(1).max(64), jobInputValueSchema),
  options: z
    .object({
      // `aspectRatio` is the only knob users have today. The decision to
      // drop the 1/2/4 "count" picker is recorded in CHANGELOG-mobile.md.
      aspectRatio: z.string().max(16).optional(),
    })
    .optional()
    .default({}),
  // Web-studio project to file the outputs into. Ownership is verified
  // in the handler; omitted (mobile) keeps the flat-history behavior.
  projectId: z.string().uuid().optional(),
});

export type CreateJobBody = z.infer<typeof createJobSchema>;
export type JobInputValueParsed = z.infer<typeof jobInputValueSchema>;

/**
 * Body for `POST /v1/jobs/create` — the prompt-first "create from
 * scratch" flow. Distinct from `createJobSchema` (which is template-
 * driven) so the two paths never share a schema or a handler.
 *
 * The model, prompt, aspect ratio and duration are first-class here;
 * attachments are optional images (start/end frame + references) whose
 * per-model rules are enforced semantically in `validateCreateSubmission`.
 */
/**
 * Studio tool request — Camera Angle / Storyboard. A tool job's model,
 * quality tier and prompt are decided SERVER-side (the engineered
 * prompt is composed in the worker); the client sends only these
 * structured parameters plus, for storyboard, the script in `prompt`.
 */
export const createToolSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('camera_angle'),
    // Orbit degrees from the widget: horizontal -180..180, vertical
    // -80..80 (matching the widget's own clamp).
    h: z.number().min(-180).max(180),
    v: z.number().min(-80).max(80),
  }),
  z.object({
    kind: z.literal('storyboard'),
    style: z.enum(['hand_drawn', 'sketch', 'realistic', 'comic', '3d']),
    // The offered grids are 2x2 / 3x2 / 3x3 / 4x3 — capped so every
    // panel stays sharp on one sheet.
    cols: z.number().int().min(2).max(4),
    rows: z.number().int().min(2).max(3),
  }),
]);

export const createUserJobSchema = z.object({
  // Optional because tool jobs resolve their model server-side; plain
  // create submissions must still send one (enforced in the handler).
  modelKey: z.string().min(1).max(128).optional(),
  // May be empty for Camera Angle (the whole prompt is engineered);
  // required otherwise — enforced semantically in validation.
  prompt: z.string().max(10_000),
  tool: createToolSchema.optional(),
  aspectRatio: z.string().max(16).optional(),
  // Video length in seconds. Bounded generously; the real per-model
  // allow-list is checked in validation against the capability registry.
  duration: z.number().int().positive().max(60).optional(),
  // Native audio (models with `supportsSound`; others ignore it with a
  // compile warning rather than a hard error).
  sound: z.boolean().optional(),
  // Quality tier for models with selectable modes. The key vocabulary is
  // per-provider — Kling std/pro/4k, Gemini 512/1K/2K/4K, OpenAI
  // low/medium/high — so this is bounded but not enumerated, matching
  // `aspectRatio` above. The handler rejects any key the selected model
  // does not declare; the charge uses `provider_models.tier_pricing[quality]`.
  quality: z.string().min(1).max(16).optional(),
  // Omni sub-task (Seedance 2.5): `edit` reworks the attached reference
  // video per the prompt; `extend` continues/stitches it. Validated
  // against the model's `supportsOmniTaskType` + video budget.
  task: z.enum(['edit', 'extend']).optional(),
  startFrame: jobInputImageSchema.optional(),
  endFrame: jobInputImageSchema.optional(),
  // References: images everywhere; video and audio clips on Seedance
  // (role: reference_video / reference_audio). Hard ceiling matches the
  // largest combined budget (Seedance 2.5 = 30 images + 10 videos + 10
  // audio); per-model, per-kind caps are enforced in validation.
  references: z.array(createReferenceSchema).max(50).optional().default([]),
  // Kling 3.0 family multi-shot storyboard: per-shot duration + prompt.
  // Kling caps it at 6 shots of ≤512 characters; per-model support and
  // the "durations sum to the clip length" rule are checked in
  // validation against the capability registry.
  shots: z
    .array(
      z.object({
        seconds: z.number().int().min(1).max(60),
        text: z.string().min(1).max(512),
      }),
    )
    .min(2)
    .max(6)
    .optional(),
  // Web-studio project to file the outputs into. Ownership is verified
  // in the handler; omitted (mobile) keeps the flat-history behavior.
  projectId: z.string().uuid().optional(),
});

export type CreateUserJobBody = z.infer<typeof createUserJobSchema>;
