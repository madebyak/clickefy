/**
 * What a database-driven fal model row must look like before it is
 * allowed into the registry.
 *
 * The admin screen writes `provider_models.capabilities` for fal models;
 * the loader (`dynamic-models.ts`) and the worker trust nothing until it
 * passes this. A row that fails is skipped with a warning rather than
 * crashing the request — one bad admin edit must not take the model
 * picker down for everyone.
 *
 * Deliberately narrower than `ModelCapabilities`: the fields the generic
 * fal compiler, the create roster DTO and the pricing page actually read.
 * Anything else an admin pastes is dropped on write (`.strip()`), so the
 * stored blob stays readable.
 */

import { z } from 'zod';

import type { FalSpec, ModelCapabilities } from '@clickfy/providers';

const endpointId = z.string().min(3).regex(/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/i, 'fal endpoint ids look like owner/model/task');

const enumMap = z.record(z.string(), z.string()).optional();
/** Limit a field to some tasks (an endpoint that lacks it would 422). */
const taskList = z.array(z.enum(['text', 'image', 'reference'])).min(1).optional();

export const falSpecSchema = z
  .object({
    endpoints: z
      .object({
        text: endpointId.optional(),
        image: endpointId.optional(),
        reference: endpointId.optional(),
      })
      .refine((e) => e.text || e.image || e.reference, 'at least one endpoint is required'),
    input: z.object({
      prompt: z.string().min(1).optional(),
      negativePrompt: z.string().min(1).optional(),
      aspectRatio: z.object({ field: z.string().min(1), values: enumMap, tasks: taskList }).optional(),
      mode: z.object({ field: z.string().min(1), values: enumMap, tasks: taskList }).optional(),
      duration: z
        .discriminatedUnion('as', [
          z.object({ field: z.string().min(1), as: z.literal('number'), tasks: taskList }),
          z.object({ field: z.string().min(1), as: z.literal('string'), tasks: taskList }),
          z.object({
            field: z.string().min(1),
            as: z.literal('frames'),
            fps: z.number().int().min(1).max(120),
            plusOne: z.boolean().optional(),
            tasks: taskList,
          }),
        ])
        .optional(),
      imageUrl: z.string().min(1).optional(),
      endImageUrl: z.string().min(1).optional(),
      referenceImages: z
        .object({
          field: z.string().min(1),
          max: z.number().int().min(1).max(50),
          style: z.enum(['array', 'indexed']).optional(),
        })
        .optional(),
      numOutputs: z.string().min(1).optional(),
      seed: z.string().min(1).optional(),
      extra: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .strict();

const aspectRatio = z.string().regex(/^\d+:\d+$/, 'aspect ratios look like 16:9');

export const falModelCapabilitiesSchema = z
  .object({
    provider: z.literal('fal'),
    modelKey: z.string().min(2).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'),
    displayName: z.string().min(1).max(80),
    status: z.enum(['active', 'preview', 'deprecated']),
    kind: z.enum(['image', 'video', 'audio']),
    sizing: z.object({
      mode: z.literal('aspect'),
      values: z.array(aspectRatio).min(1),
      resolutions: z.array(z.string()).optional(),
      defaultResolution: z.string().optional(),
    }),
    outputs: z.object({
      min: z.number().int().min(1),
      max: z.number().int().min(1).max(10),
      default: z.number().int().min(1),
    }),
    duration: z
      .object({ values: z.array(z.number().positive()).min(1), default: z.number().positive() })
      .optional(),
    modes: z
      .object({
        values: z.array(z.string().min(1)).min(1),
        default: z.string().min(1),
        labels: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    refAddressing: z.enum(['ordinal', 'at', 'none']).default('ordinal'),
    maxReferences: z.number().int().min(0).max(50),
    maxSubjects: z.number().int().min(0).max(50),
    maxImagesTotal: z.number().int().min(0).max(50),
    acceptsStartEndImage: z.boolean().optional(),
    negativePrompt: z.boolean().optional(),
    supportsSound: z.boolean().optional(),
    maxPromptChars: z.number().int().min(100).max(20000).optional(),
    acceptedImageMimes: z.array(z.string()).optional(),
    imageConstraints: z
      .object({ minEdge: z.number().int().positive(), minAspect: z.number().positive(), maxAspect: z.number().positive() })
      .optional(),
    notes: z.string().max(500).optional(),
    fal: falSpecSchema,
  })
  .strip()
  .superRefine((c, ctx) => {
    if (c.kind === 'video' && !c.duration) {
      ctx.addIssue({ code: 'custom', path: ['duration'], message: 'video models need a duration list' });
    }
    if (c.duration && !c.duration.values.includes(c.duration.default)) {
      ctx.addIssue({ code: 'custom', path: ['duration', 'default'], message: 'default must be one of values' });
    }
    if (c.modes && !c.modes.values.includes(c.modes.default)) {
      ctx.addIssue({ code: 'custom', path: ['modes', 'default'], message: 'default must be one of values' });
    }
    if (c.outputs.default < c.outputs.min || c.outputs.default > c.outputs.max) {
      ctx.addIssue({ code: 'custom', path: ['outputs', 'default'], message: 'default must sit within min..max' });
    }
    if (c.fal.input.mode && !c.modes) {
      ctx.addIssue({ code: 'custom', path: ['modes'], message: 'the spec maps a tier field, so modes must list the tiers' });
    }
    if (c.fal.input.referenceImages && c.maxReferences === 0) {
      ctx.addIssue({ code: 'custom', path: ['maxReferences'], message: 'the spec takes references, so maxReferences must be > 0' });
    }
  });

export type FalModelCapabilities = z.infer<typeof falModelCapabilitiesSchema>;

/** Narrow the parsed blob to the registry type (the shapes are compatible by construction). */
export function toModelCapabilities(parsed: FalModelCapabilities): ModelCapabilities {
  return parsed as unknown as ModelCapabilities & { fal: FalSpec };
}
