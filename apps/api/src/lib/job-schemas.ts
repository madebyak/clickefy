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
