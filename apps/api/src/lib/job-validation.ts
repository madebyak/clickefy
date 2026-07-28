/**
 * `validateJobSubmission` — semantic validation of a `POST /v1/jobs`
 * body against a specific template + user.
 *
 * Runs AFTER Zod has confirmed the body's *shape*. This pass is about
 * meaning: does the user own these R2 keys? Is "blue" a valid value
 * for this select field? Is the aspect ratio the template actually
 * allows? Each rejection comes back as a structured `JobValidationError`
 * so the mobile app can show the right copy.
 *
 * R2 ownership is enforced two ways:
 *   1. The key must start with `user-uploads/<userId>/` — anything
 *      else is either an admin asset or another user's upload, which
 *      a job submission may never reference.
 *   2. A HEAD request to the bucket confirms the object exists. This
 *      catches "client lied about the key" and "file was deleted in
 *      the meantime" cases. We deliberately skip cross-checking the
 *      stored size/mime against the body — the upload route already
 *      validated those at write time, and re-validating doubles the
 *      number of R2 round-trips per submission for negligible gain.
 *
 * All R2 HEAD calls run in parallel (`Promise.all`), so worst case is
 * "slowest single HEAD" rather than sum of all of them.
 */

import type { TemplateInputField } from '@clickfy/db';
import type { CreateJobBody, CreateUserJobBody, JobInputValueParsed } from './job-schemas';

export type JobValidationErrorCode =
  | 'template_not_published'
  | 'template_no_version'
  | 'input_missing'
  | 'input_invalid_type'
  | 'input_text_too_long'
  | 'input_select_invalid_option'
  | 'forbidden_r2_key'
  | 'r2_key_not_found'
  | 'unsupported_mime'
  | 'aspect_not_allowed'
  | 'insufficient_credits'
  // ── Create-flow (prompt-first) codes ──
  | 'prompt_empty'
  | 'prompt_too_long'
  | 'model_no_images'
  | 'model_requires_image'
  | 'end_frame_not_supported'
  | 'too_many_images'
  | 'duration_not_allowed';

export interface JobValidationError {
  code: JobValidationErrorCode;
  message: string;
  fieldKey?: string;
  // Free-form extra context for the mobile UI to render
  // ("need 3 more credits", "expected 1024x1024", etc.).
  details?: Record<string, unknown>;
}

export interface JobValidationContext {
  userId: string;
  uploadsBucket: R2Bucket;
  template: {
    id: string;
    status: 'draft' | 'published' | 'archived';
    userInputs: TemplateInputField[];
    userCanChooseAspectRatio: boolean;
    defaultAspectRatio: string | null;
    costCredits: number;
  };
  // Pre-fetched balance from the same SELECT used by the caller —
  // passing it through avoids a second round-trip and keeps the
  // "insufficient_credits" error message synced with the value we
  // saw moments before the atomic debit.
  currentCreditsBalance: number;
  // List of aspect ratios this template's pipeline can actually emit.
  // The capability registry computes this from the model + provider;
  // the route handler resolves it before calling us so this module
  // stays pure (no dependency on `@clickfy/providers`).
  allowedAspectRatios: string[];
}

export async function validateJobSubmission(
  body: CreateJobBody,
  ctx: JobValidationContext,
): Promise<JobValidationError | null> {
  // ── Template status ────────────────────────────────────────────
  if (ctx.template.status !== 'published') {
    return {
      code: 'template_not_published',
      message: 'This template is not available right now.',
    };
  }

  // ── Required-field presence + per-field semantic checks ────────
  const inputs = body.inputs ?? {};

  for (const def of ctx.template.userInputs) {
    const submitted = inputs[def.fieldKey];

    if (!submitted) {
      if (def.required) {
        return {
          code: 'input_missing',
          message: `Missing required field "${def.label}".`,
          fieldKey: def.fieldKey,
        };
      }
      // Optional and absent — nothing to validate.
      continue;
    }

    // Discriminator mismatch ("image" field but text submitted, etc.).
    const expected = expectedInputKind(def.type);
    if (expected !== submitted.kind) {
      return {
        code: 'input_invalid_type',
        message: `Field "${def.label}" expects a ${expected}, got ${submitted.kind}.`,
        fieldKey: def.fieldKey,
        details: { expected, actual: submitted.kind },
      };
    }

    // Text-shape constraints.
    if (submitted.kind === 'text') {
      if (def.required && submitted.value.trim().length === 0) {
        return {
          code: 'input_missing',
          message: `Field "${def.label}" cannot be empty.`,
          fieldKey: def.fieldKey,
        };
      }
      if ((def.type === 'text' || def.type === 'textarea') && def.maxLength) {
        if (submitted.value.length > def.maxLength) {
          return {
            code: 'input_text_too_long',
            message: `Field "${def.label}" exceeds the ${def.maxLength}-character limit.`,
            fieldKey: def.fieldKey,
            details: { maxLength: def.maxLength, actual: submitted.value.length },
          };
        }
      }
      if (def.type === 'select') {
        const valid = def.options.some((opt) => opt.value === submitted.value);
        if (!valid) {
          return {
            code: 'input_select_invalid_option',
            message: `"${submitted.value}" is not a valid option for "${def.label}".`,
            fieldKey: def.fieldKey,
            details: { allowed: def.options.map((o) => o.value) },
          };
        }
      }
    }

    // Media-shape constraints — ownership prefix check is cheap and
    // synchronous; the HEAD existence check runs in the parallel
    // batch below.
    if (submitted.kind === 'image' || submitted.kind === 'video') {
      const expectedPrefix = `user-uploads/${ctx.userId}/`;
      if (!submitted.r2Key.startsWith(expectedPrefix)) {
        return {
          code: 'forbidden_r2_key',
          message: `R2 key for "${def.label}" doesn't belong to you.`,
          fieldKey: def.fieldKey,
        };
      }
      if (def.type === 'image' || def.type === 'image_multi' || def.type === 'video') {
        if (def.acceptedFormats && def.acceptedFormats.length > 0) {
          if (!def.acceptedFormats.includes(submitted.mimeType)) {
            return {
              code: 'unsupported_mime',
              message: `"${submitted.mimeType}" is not allowed for "${def.label}".`,
              fieldKey: def.fieldKey,
              details: { allowed: def.acceptedFormats, actual: submitted.mimeType },
            };
          }
        }
      }
    }
  }

  // ── R2 existence check (parallel HEADs) ────────────────────────
  const mediaInputs = Object.entries(inputs).filter(
    (entry): entry is [string, Extract<JobInputValueParsed, { kind: 'image' | 'video' }>] => {
      return entry[1].kind === 'image' || entry[1].kind === 'video';
    },
  );

  const headResults = await Promise.all(
    mediaInputs.map(async ([fieldKey, val]) => {
      // R2's head() returns null when the object is absent.
      const obj = await ctx.uploadsBucket.head(val.r2Key);
      return { fieldKey, r2Key: val.r2Key, exists: obj !== null };
    }),
  );

  const missing = headResults.find((r) => !r.exists);
  if (missing) {
    return {
      code: 'r2_key_not_found',
      message: `Uploaded file for "${missing.fieldKey}" could not be found in storage.`,
      fieldKey: missing.fieldKey,
      details: { r2Key: missing.r2Key },
    };
  }

  // ── Aspect ratio (only when the template lets users pick) ──────
  if (body.options?.aspectRatio !== undefined) {
    if (!ctx.template.userCanChooseAspectRatio) {
      return {
        code: 'aspect_not_allowed',
        message: 'This template does not support choosing an aspect ratio.',
        details: { submitted: body.options.aspectRatio },
      };
    }
    if (
      ctx.allowedAspectRatios.length > 0 &&
      !ctx.allowedAspectRatios.includes(body.options.aspectRatio)
    ) {
      return {
        code: 'aspect_not_allowed',
        message: `Aspect ratio "${body.options.aspectRatio}" is not supported by this template.`,
        details: {
          submitted: body.options.aspectRatio,
          allowed: ctx.allowedAspectRatios,
        },
      };
    }
  }

  // ── Credit balance (pre-check; the atomic CTE re-checks server-side) ─
  if (ctx.currentCreditsBalance < ctx.template.costCredits) {
    return {
      code: 'insufficient_credits',
      message: 'Not enough credits.',
      details: {
        required: ctx.template.costCredits,
        available: ctx.currentCreditsBalance,
      },
    };
  }

  return null;
}

/**
 * Map a template input's `type` to the matching `JobInputValue.kind`.
 *
 * Multi-image and color fields are explicitly listed even though we
 * don't ship them on mobile in v1 — the worker should fail clearly if
 * a future admin form starts emitting them before mobile catches up.
 */
function expectedInputKind(type: TemplateInputField['type']): 'image' | 'video' | 'text' {
  switch (type) {
    case 'image':
    case 'image_multi':
      return 'image';
    case 'video':
      return 'video';
    case 'text':
    case 'textarea':
    case 'select':
    case 'toggle':
    case 'color':
      return 'text';
  }
}

// ─── Create-flow (prompt-first) validation ──────────────────────────

export interface CreateValidationContext {
  userId: string;
  uploadsBucket: R2Bucket;
  /**
   * Model capability slice, pre-resolved by the route from
   * `@clickfy/providers` so this module stays free of that dependency.
   */
  model: {
    modelKey: string;
    kind: 'image' | 'video';
    /** Total input-image budget (0 = model accepts no images). */
    maxImagesTotal: number;
    /** Per-model prompt character cap; undefined = use the default. */
    maxPromptChars?: number;
    /** Aspect ratios the model emits ([] = not user-choosable). */
    allowedAspectRatios: string[];
    /** Video durations in seconds ([] = not a video model). */
    allowedDurations: number[];
    /** True when the model is image-to-video only (needs a start frame). */
    requiresStartFrame: boolean;
    /** Whether an end frame is meaningful for this model. */
    acceptsStartEndImage: boolean;
    /** Flat per-model cost in credits. */
    cost: number;
  };
  currentCreditsBalance: number;
}

/** Conservative fallback when a model declares no `maxPromptChars`. */
const DEFAULT_MAX_PROMPT_CHARS = 2500;

/**
 * Semantic validation for `POST /v1/jobs/create`. Runs after Zod. Mirrors
 * the ownership + existence guarantees of `validateJobSubmission` for the
 * attachment images, and adds the model-adaptive rules (prompt length,
 * image budget, image-to-video requirement, aspect/duration allow-lists).
 */
export async function validateCreateSubmission(
  body: CreateUserJobBody,
  ctx: CreateValidationContext,
): Promise<JobValidationError | null> {
  const { model } = ctx;

  // ── Prompt ─────────────────────────────────────────────────────
  const prompt = body.prompt.trim();
  if (prompt.length === 0) {
    return { code: 'prompt_empty', message: 'Enter a prompt to generate.' };
  }
  const promptCap = model.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  if (body.prompt.length > promptCap) {
    return {
      code: 'prompt_too_long',
      message: `Prompt exceeds the ${promptCap.toLocaleString()}-character limit for this model.`,
      details: { maxLength: promptCap, actual: body.prompt.length },
    };
  }

  // ── Assemble attachments (canonical field keys for error copy) ──
  const attachments: Array<{ fieldKey: string; val: Extract<JobInputValueParsed, { kind: 'image' }> }> = [];
  if (body.startFrame) attachments.push({ fieldKey: 'start_frame', val: body.startFrame });
  if (body.endFrame) attachments.push({ fieldKey: 'end_frame', val: body.endFrame });
  body.references.forEach((r, i) => attachments.push({ fieldKey: `ref_${i}`, val: r }));

  // ── Image-budget rules ─────────────────────────────────────────
  if (model.maxImagesTotal === 0 && attachments.length > 0) {
    return {
      code: 'model_no_images',
      message: 'This model does not accept input images.',
    };
  }
  if (model.requiresStartFrame && !body.startFrame) {
    return {
      code: 'model_requires_image',
      message: 'This model needs a start image to animate. Attach one to continue.',
    };
  }
  if (body.endFrame && !model.acceptsStartEndImage) {
    return {
      code: 'end_frame_not_supported',
      message: 'This model does not support an end frame.',
    };
  }
  if (attachments.length > model.maxImagesTotal) {
    return {
      code: 'too_many_images',
      message: `This model accepts at most ${model.maxImagesTotal} image(s).`,
      details: { max: model.maxImagesTotal, actual: attachments.length },
    };
  }

  // ── R2 ownership (prefix) + existence (parallel HEADs) ─────────
  const expectedPrefix = `user-uploads/${ctx.userId}/`;
  for (const a of attachments) {
    if (!a.val.r2Key.startsWith(expectedPrefix)) {
      return {
        code: 'forbidden_r2_key',
        message: 'An attached image does not belong to you.',
        fieldKey: a.fieldKey,
      };
    }
  }
  const heads = await Promise.all(
    attachments.map(async (a) => ({
      fieldKey: a.fieldKey,
      r2Key: a.val.r2Key,
      exists: (await ctx.uploadsBucket.head(a.val.r2Key)) !== null,
    })),
  );
  const missing = heads.find((h) => !h.exists);
  if (missing) {
    return {
      code: 'r2_key_not_found',
      message: 'An attached image could not be found in storage.',
      fieldKey: missing.fieldKey,
      details: { r2Key: missing.r2Key },
    };
  }

  // ── Aspect ratio ───────────────────────────────────────────────
  if (body.aspectRatio !== undefined && model.allowedAspectRatios.length > 0) {
    if (!model.allowedAspectRatios.includes(body.aspectRatio)) {
      return {
        code: 'aspect_not_allowed',
        message: `Aspect ratio "${body.aspectRatio}" is not supported by this model.`,
        details: { submitted: body.aspectRatio, allowed: model.allowedAspectRatios },
      };
    }
  }

  // ── Duration ───────────────────────────────────────────────────
  if (body.duration !== undefined) {
    if (model.kind !== 'video' || model.allowedDurations.length === 0) {
      return {
        code: 'duration_not_allowed',
        message: 'This model does not support a duration setting.',
        details: { submitted: body.duration },
      };
    }
    if (!model.allowedDurations.includes(body.duration)) {
      return {
        code: 'duration_not_allowed',
        message: `Duration ${body.duration}s is not supported by this model.`,
        details: { submitted: body.duration, allowed: model.allowedDurations },
      };
    }
  }

  // ── Credit balance (pre-check; the CTE re-checks authoritatively) ─
  if (ctx.currentCreditsBalance < model.cost) {
    return {
      code: 'insufficient_credits',
      message: 'Not enough credits.',
      details: { required: model.cost, available: ctx.currentCreditsBalance },
    };
  }

  return null;
}
