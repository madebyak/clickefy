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

const jobInputTextSchema = z.object({
  kind: z.literal('text'),
  // Empty strings allowed for non-required fields the user left blank.
  // The required-presence check lives in `job-validation.ts`.
  value: z.string().max(10_000),
});

export const jobInputValueSchema = z.discriminatedUnion('kind', [
  jobInputImageSchema,
  jobInputVideoSchema,
  jobInputTextSchema,
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
export const createUserJobSchema = z.object({
  modelKey: z.string().min(1).max(128),
  prompt: z.string().min(1).max(10_000),
  aspectRatio: z.string().max(16).optional(),
  // Video length in seconds. Bounded generously; the real per-model
  // allow-list is checked in validation against the capability registry.
  duration: z.number().int().positive().max(60).optional(),
  // Native audio (models with `supportsSound`; others ignore it with a
  // compile warning rather than a hard error).
  sound: z.boolean().optional(),
  // Quality tier for models with selectable modes (Kling std/pro/4k).
  // Validated against the model's capability list in the handler; the
  // charge uses `provider_models.tier_pricing[quality]`.
  quality: z.enum(['std', 'pro', '4k']).optional(),
  startFrame: jobInputImageSchema.optional(),
  endFrame: jobInputImageSchema.optional(),
  // Reference / subject images. Hard ceiling matches the largest model
  // budget (Gemini = 14); per-model caps are enforced in validation.
  references: z.array(jobInputImageSchema).max(16).optional().default([]),
});

export type CreateUserJobBody = z.infer<typeof createUserJobSchema>;
