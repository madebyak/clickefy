/**
 * Zod schemas for template payloads.
 *
 * Two layers:
 *   - JSON shapes (MediaRef, GenerationStage, TemplateInputField, …) —
 *     used both at the API boundary and as sub-pieces of the
 *     create/update bodies.
 *   - Create / Update bodies the admin form submits.
 *
 * The discriminated unions deliberately mirror the TS types in
 * `@clickfy/types/json-types.ts`. A mismatch will show up as a type
 * error in the route handler (since the inferred zod type feeds into
 * the Drizzle insert), so the two stay honest.
 */

import { z } from 'zod';

// ─── Media ──────────────────────────────────────────────────────────

export const mediaRefSchema = z.object({
  r2Key: z.string().min(1).max(512),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
  blurhash: z.string().max(256).default(''),
  cdnUrl: z.string().url().max(2048).optional(),
});

export const streamRefSchema = z.object({
  streamId: z.string().min(1).max(128),
  durationSec: z.number().positive().max(600),
  posterR2Key: z.string().min(1).max(512),
});

// ─── Input fields (discriminated union mirroring TemplateInputField) ─

const inputBaseFields = {
  id: z.string().min(1).max(80),
  fieldKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'fieldKey must start with a letter and contain only lowercase letters, digits, and underscores.'),
  label: z.string().min(1).max(120),
  helperText: z.string().max(280).optional(),
  required: z.boolean(),
  order: z.number().int().min(0).max(99),
};

const acceptedFormatsSchema = z.array(z.string().min(1).max(80)).max(16);
const resolutionSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const inputTextSchema = z.object({
  ...inputBaseFields,
  type: z.literal('text'),
  placeholder: z.string().max(280).optional(),
  maxLength: z.number().int().positive().max(10_000).optional(),
});

const inputTextareaSchema = z.object({
  ...inputBaseFields,
  type: z.literal('textarea'),
  placeholder: z.string().max(280).optional(),
  maxLength: z.number().int().positive().max(10_000).optional(),
  minLines: z.number().int().min(1).max(20).optional(),
});

const inputImageSchema = z.object({
  ...inputBaseFields,
  type: z.literal('image'),
  acceptedFormats: acceptedFormatsSchema.optional(),
  maxSizeMB: z.number().positive().max(50).optional(),
  minResolution: resolutionSchema.optional(),
  aspectRatio: z.string().max(16).optional(),
});

const inputImageMultiSchema = z.object({
  ...inputBaseFields,
  type: z.literal('image_multi'),
  minCount: z.number().int().min(1).max(20),
  maxCount: z.number().int().min(1).max(20),
  acceptedFormats: acceptedFormatsSchema.optional(),
  maxSizeMB: z.number().positive().max(50).optional(),
  aspectRatio: z.string().max(16).optional(),
});

const inputVideoSchema = z.object({
  ...inputBaseFields,
  type: z.literal('video'),
  acceptedFormats: acceptedFormatsSchema.optional(),
  maxSizeMB: z.number().positive().max(200).optional(),
  maxDurationSec: z.number().positive().max(600).optional(),
});

const inputSelectSchema = z.object({
  ...inputBaseFields,
  type: z.literal('select'),
  options: z
    .array(
      z.object({
        value: z.string().min(1).max(80),
        label: z.string().min(1).max(120),
        thumbUrl: z.string().url().optional(),
      }),
    )
    .min(2)
    .max(40),
  asChips: z.boolean().optional(),
});

const inputToggleSchema = z.object({
  ...inputBaseFields,
  type: z.literal('toggle'),
  defaultOn: z.boolean().optional(),
});

const inputColorSchema = z.object({
  ...inputBaseFields,
  type: z.literal('color'),
  presets: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).max(20).optional(),
});

export const inputFieldSchema = z.discriminatedUnion('type', [
  inputTextSchema,
  inputTextareaSchema,
  inputImageSchema,
  inputImageMultiSchema,
  inputVideoSchema,
  inputSelectSchema,
  inputToggleSchema,
  inputColorSchema,
]);

// ─── Generation (admin-only) ────────────────────────────────────────

const generationReferenceSchema = z.object({
  id: z.string().min(1).max(80),
  // Slug-style identifier referenced from the prompt as `{{ref:<key>}}`.
  // Must be unique within a stage. Constrained to a safe character set
  // so the substitution regex stays simple and the key is safe to embed
  // in provider payloads (e.g. `<<<image_<key>>>` for Kling Omni).
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Reference key must start with a letter and contain only lowercase letters, digits, and underscores.',
    ),
  role: z.enum(['style', 'composition', 'lighting', 'scene', 'example']),
  r2Key: z.string().min(1).max(512).optional(),
  // Authoring-only fields. The admin form keeps the image in memory as
  // base64 while the R2 upload is in flight; the API permits them on
  // the wire for round-trip, but the executor only consumes `r2Key`.
  base64: z.string().optional(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  label: z.string().optional(),
});

const generationStageSchema = z.object({
  id: z.string().min(1).max(80),
  order: z.number().int().min(0).max(99),
  provider: z.enum(['gemini', 'kling']),
  model: z.string().min(1).max(128),
  prompt: z.string().max(8000),
  references: z.array(generationReferenceSchema).max(20),
  config: z.record(z.string(), z.unknown()),
  retry: z.object({
    enabled: z.boolean(),
    maxAttempts: z.number().int().min(1).max(10),
    fallbackModel: z.string().optional(),
  }),
});

export const templateGenerationSchema = z.object({
  mode: z.enum(['image', 'video', 'image_then_video']),
  stages: z.array(generationStageSchema).max(10),
});

export const templateOutputSchema = z.object({
  type: z.enum(['image', 'video', 'both']),
  count: z.number().int().min(1).max(10),
  format: z.string().min(1).max(16),
  allowRegeneration: z.boolean(),
  watermark: z.enum(['always', 'free_only', 'never']).optional(),
});

// ─── Top-level bodies ───────────────────────────────────────────────

export const templateKindSchema = z.enum(['image', 'video', 'image_set']);
export const templateStatusSchema = z.enum(['draft', 'published', 'archived']);

/**
 * Create / Update payload from the admin form. `slug` is derived
 * server-side from `title` if omitted.
 */
export const createTemplateSchema = z.object({
  title: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, digits, and hyphens only.')
    .optional(),
  description: z.string().max(2000).default(''),
  authorName: z.string().min(1).max(80).default('Clickfy Studio'),
  categoryId: z.string().uuid(),
  kind: templateKindSchema,
  featured: z.boolean().default(false),

  coverMedia: mediaRefSchema,
  previewVideo: streamRefSchema.nullable().optional(),
  gallery: z.array(mediaRefSchema).max(12).default([]),

  userInputs: z.array(inputFieldSchema).max(20).default([]),
  userCanChooseAspectRatio: z.boolean().default(false),
  defaultAspectRatio: z.string().max(16).nullable().optional(),

  generation: templateGenerationSchema,
  output: templateOutputSchema,

  costCredits: z.number().int().min(0).max(1000).default(1),
  sortOrder: z.number().int().min(0).default(0),
});

/** Update is the create schema with everything optional (PATCH semantics). */
export const updateTemplateSchema = createTemplateSchema.partial();

export const reorderTemplatesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export const publishTemplateSchema = z.object({
  publishNote: z.string().max(500).optional(),
});

export type CreateTemplateBody = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateBody = z.infer<typeof updateTemplateSchema>;
