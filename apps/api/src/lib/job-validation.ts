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
import type { CreateJobBody, JobInputValueParsed } from './job-schemas';

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
  | 'insufficient_credits';

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
