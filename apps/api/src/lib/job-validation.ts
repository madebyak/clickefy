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
import { probeAudioDurationSeconds, probeVideoDurationSeconds } from './media-duration';

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
  | 'duration_not_allowed'
  // ── Reference-clip codes (Seedance video/audio references) ──
  | 'frames_and_references_exclusive'
  | 'video_reference_not_supported'
  | 'too_many_video_references'
  | 'video_reference_unreadable'
  | 'video_reference_duration'
  | 'video_references_too_long'
  | 'audio_reference_not_supported'
  | 'too_many_audio_references'
  | 'audio_reference_unreadable'
  | 'audio_reference_duration'
  | 'audio_references_too_long'
  | 'audio_reference_needs_visual'
  | 'video_task_not_supported'
  | 'video_task_needs_video'
  // ── Kling create-flow codes ──
  | 'references_not_supported'
  | 'too_many_references'
  | 'image_format_not_supported'
  | 'shots_not_supported'
  | 'shots_invalid';

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

/** Per-kind reference-clip budget (Seedance video/audio references). */
export interface ReferenceClipBudget {
  max: number;
  maxTotalSeconds: number;
  minClipSeconds: number;
  maxClipSeconds: number;
}

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
    /**
     * Kling O1: the collapsed duration list that applies when the
     * request has a start frame and nothing else (no end frame, no
     * references). Absent = no conditional.
     */
    bareStartFrameDurations?: readonly number[];
    /** True when the model is image-to-video only (needs a start frame). */
    requiresStartFrame: boolean;
    /** Whether an end frame is meaningful for this model. */
    acceptsStartEndImage: boolean;
    /** Reference VIDEO budget; absent = the model takes no video refs. */
    referenceVideo?: ReferenceClipBudget;
    /** Reference AUDIO budget; absent = the model takes no audio refs. */
    referenceAudio?: ReferenceClipBudget;
    /** Seedance 2.0 family: audio refs need an image or video alongside. */
    audioRefRequiresVisual?: boolean;
    /**
     * Seedance 2.5: the model exposes `omni_reference_task_type`, so
     * the create flow may request an `edit` / `extend` task.
     */
    supportsVideoTasks?: boolean;
    /**
     * Seedance: BytePlus forbids start/end frames and omni references
     * in one request. Enforced as a 422 rather than the old silent
     * frame-drop in `buildCreateStage`.
     */
    framesAndReferencesExclusive?: boolean;
    /**
     * Reference-image budget (`refer_image` on Kling Omni / O1, the
     * reference grid on image models). 0 = the model takes frames only,
     * so a `references[]` entry must be refused rather than silently
     * promoted to a start frame by the compiler.
     */
    maxReferences: number;
    /**
     * Image formats the provider accepts, when narrower than the upload
     * allow-list (Kling: jpeg/png only). Absent = anything uploaded.
     */
    acceptedImageMimes?: readonly string[];
    /** Kling 3.0 family multi-shot limits; absent = not supported. */
    multiShot?: { maxShots: number; maxCharsPerShot: number; minShotSeconds: number };
  };
}

/**
 * Successful validation yields what the ROUTE needs to price the job:
 * the summed input-video seconds, probed from the actual bytes in R2 —
 * never from a client claim, because the provider bills on the real
 * clip and `resolveCreditCost` turns this number into credits.
 */
export interface CreateValidationOk {
  inputVideoSeconds: number;
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
): Promise<{ error: JobValidationError } | { ok: CreateValidationOk }> {
  const { model } = ctx;
  const fail = (error: JobValidationError) => ({ error });

  // ── Prompt ─────────────────────────────────────────────────────
  // Camera Angle is the one submission with no user text at all — its
  // entire prompt is engineered from the tool parameters in the worker.
  const prompt = body.prompt.trim();
  if (prompt.length === 0 && body.tool?.kind !== 'camera_angle') {
    return fail({
      code: 'prompt_empty',
      message:
        body.tool?.kind === 'storyboard'
          ? 'Paste a script or an idea to storyboard.'
          : 'Enter a prompt to generate.',
    });
  }
  const promptCap = model.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  if (body.prompt.length > promptCap) {
    return fail({
      code: 'prompt_too_long',
      message: `Prompt exceeds the ${promptCap.toLocaleString()}-character limit for this model.`,
      details: { maxLength: promptCap, actual: body.prompt.length },
    });
  }

  // ── Assemble attachments (canonical field keys for error copy) ──
  type MediaVal = Extract<JobInputValueParsed, { kind: 'image' | 'video' | 'audio' }>;
  const attachments: Array<{ fieldKey: string; val: MediaVal }> = [];
  if (body.startFrame) attachments.push({ fieldKey: 'start_frame', val: body.startFrame });
  if (body.endFrame) attachments.push({ fieldKey: 'end_frame', val: body.endFrame });
  body.references.forEach((r, i) => attachments.push({ fieldKey: `ref_${i}`, val: r }));

  const imageAttachments = attachments.filter((a) => a.val.kind === 'image');
  const videoRefs = attachments.filter((a) => a.val.kind === 'video');
  const audioRefs = attachments.filter((a) => a.val.kind === 'audio');

  // ── Per-kind budget rules ──────────────────────────────────────
  if (model.maxImagesTotal === 0 && imageAttachments.length > 0) {
    return fail({
      code: 'model_no_images',
      message: 'This model does not accept input images.',
    });
  }
  if (model.requiresStartFrame && !body.startFrame) {
    return fail({
      code: 'model_requires_image',
      message: 'This model needs a start image to animate. Attach one to continue.',
    });
  }
  if (body.endFrame && !model.acceptsStartEndImage) {
    return fail({
      code: 'end_frame_not_supported',
      message: 'This model does not support an end frame.',
    });
  }
  if (imageAttachments.length > model.maxImagesTotal) {
    return fail({
      code: 'too_many_images',
      message: `This model accepts at most ${model.maxImagesTotal} image(s).`,
      details: { max: model.maxImagesTotal, actual: imageAttachments.length },
    });
  }
  // Reference images on a frames-only model (Kling 3, 2.6, 2.5 Turbo,
  // 3 Turbo). Refuse here: the compiler would otherwise have nothing to
  // bind them to, and the old positional path turned "two references"
  // into "a start and an end frame".
  const imageRefs = body.references.filter((r) => r.kind === 'image');
  if (imageRefs.length > 0 && model.maxReferences === 0) {
    return fail({
      code: 'references_not_supported',
      message: 'This model takes a start frame (and optional end frame), not reference images.',
    });
  }
  if (imageRefs.length > model.maxReferences) {
    return fail({
      code: 'too_many_references',
      message: `This model accepts at most ${model.maxReferences} reference image(s).`,
      details: { max: model.maxReferences, actual: imageRefs.length },
    });
  }
  // Provider image formats (Kling: jpeg/png only). A WebP start frame is
  // accepted by our uploads and rejected by Kling — after the debit.
  if (model.acceptedImageMimes) {
    const bad = imageAttachments.find(
      (a) => !model.acceptedImageMimes!.includes(a.val.mimeType.toLowerCase()),
    );
    if (bad) {
      return fail({
        code: 'image_format_not_supported',
        message: `This model accepts ${model.acceptedImageMimes
          .map((m) => m.replace('image/', '').toUpperCase())
          .join(' and ')} images only.`,
        fieldKey: bad.fieldKey,
        details: { allowed: [...model.acceptedImageMimes], actual: bad.val.mimeType },
      });
    }
  }
  // Multi-shot (Kling 3.0 family). Structure is checked by Zod; here the
  // model must support it and the shots must fill the clip exactly.
  if (body.shots && body.shots.length > 1) {
    if (!model.multiShot) {
      return fail({
        code: 'shots_not_supported',
        message: 'This model does not support multi-shot prompts.',
      });
    }
    if (body.shots.length > model.multiShot.maxShots) {
      return fail({
        code: 'shots_invalid',
        message: `This model supports up to ${model.multiShot.maxShots} shots.`,
        details: { max: model.multiShot.maxShots, actual: body.shots.length },
      });
    }
    const tooLong = body.shots.find((sh) => sh.text.length > model.multiShot!.maxCharsPerShot);
    if (tooLong) {
      return fail({
        code: 'shots_invalid',
        message: `Each shot prompt can be up to ${model.multiShot.maxCharsPerShot} characters.`,
      });
    }
    const total = body.shots.reduce((acc, sh) => acc + sh.seconds, 0);
    if (body.duration !== undefined && total !== body.duration) {
      return fail({
        code: 'shots_invalid',
        message: `Shot durations add up to ${total}s but the clip is ${body.duration}s — they must match.`,
        details: { total, duration: body.duration },
      });
    }
  }

  // Seedance: frames and omni references cannot share a request. A 422
  // here beats the old behavior (buildCreateStage silently dropped the
  // frames), which billed the user for a request that ignored half of
  // what they attached.
  if (
    model.framesAndReferencesExclusive &&
    (body.startFrame || body.endFrame) &&
    body.references.length > 0
  ) {
    return fail({
      code: 'frames_and_references_exclusive',
      message:
        'This model takes either start/end frames or reference files — not both in one generation.',
    });
  }

  if (videoRefs.length > 0 && !model.referenceVideo) {
    return fail({
      code: 'video_reference_not_supported',
      message: 'This model does not accept video references.',
    });
  }
  if (model.referenceVideo && videoRefs.length > model.referenceVideo.max) {
    return fail({
      code: 'too_many_video_references',
      message: `This model accepts at most ${model.referenceVideo.max} video reference(s).`,
      details: { max: model.referenceVideo.max, actual: videoRefs.length },
    });
  }
  if (audioRefs.length > 0 && !model.referenceAudio) {
    return fail({
      code: 'audio_reference_not_supported',
      message: 'This model does not accept audio references.',
    });
  }
  if (model.referenceAudio && audioRefs.length > model.referenceAudio.max) {
    return fail({
      code: 'too_many_audio_references',
      message: `This model accepts at most ${model.referenceAudio.max} audio reference(s).`,
      details: { max: model.referenceAudio.max, actual: audioRefs.length },
    });
  }
  // Seedance 2.0 family: audio-only input is a 2.5-exclusive — audio
  // refs need at least one visual (image or video) alongside.
  if (
    model.audioRefRequiresVisual &&
    audioRefs.length > 0 &&
    imageAttachments.length === 0 &&
    videoRefs.length === 0
  ) {
    return fail({
      code: 'audio_reference_needs_visual',
      message: 'This model needs at least one image or video alongside an audio reference.',
    });
  }

  // ── Studio tools (Camera Angle / Storyboard) ───────────────────
  if (body.tool) {
    if (body.task) {
      return fail({
        code: 'video_task_not_supported',
        message: 'A tool request cannot also be an edit or extend task.',
      });
    }
    if (body.startFrame || body.endFrame) {
      return fail({
        code: 'frames_and_references_exclusive',
        message: 'Tool requests do not take start or end frames.',
      });
    }
    if (body.tool.kind === 'camera_angle') {
      // Exactly the photo being re-shot, nothing else.
      if (imageAttachments.length !== 1 || body.references.length !== 1) {
        return fail({
          code: 'model_requires_image',
          message: 'Attach the photo you want to re-shoot.',
        });
      }
    } else {
      // Storyboard is text-to-sheet — the script is the only input.
      if (attachments.length > 0) {
        return fail({
          code: 'model_no_images',
          message: 'Storyboard works from your script alone — no attachments.',
        });
      }
    }
  }

  // ── Edit / Extend sub-tasks (Seedance 2.5) ─────────────────────
  if (body.task) {
    if (!model.supportsVideoTasks) {
      return fail({
        code: 'video_task_not_supported',
        message: 'This model cannot edit or extend videos.',
      });
    }
    if (videoRefs.length === 0) {
      return fail({
        code: 'video_task_needs_video',
        message:
          body.task === 'edit'
            ? 'Attach the video you want to edit.'
            : 'Attach the video you want to extend.',
      });
    }
    // v1 keeps edit to a single source clip — BytePlus's own edit
    // examples use exactly one, and "which video gets the edit" has no
    // UI answer for several. Extend legitimately chains clips.
    if (body.task === 'edit' && videoRefs.length > 1) {
      return fail({
        code: 'video_task_needs_video',
        message: 'Editing works on one video at a time.',
      });
    }
    // Edit output length follows the source clip (duration is pinned to
    // -1 on the wire) — a duration pick would be a lie.
    if (body.task === 'edit' && body.duration !== undefined) {
      return fail({
        code: 'duration_not_allowed',
        message: 'Edited videos keep the length of the source clip.',
      });
    }
  }

  // ── R2 ownership (prefix) + existence (parallel HEADs) ─────────
  const expectedPrefix = `user-uploads/${ctx.userId}/`;
  for (const a of attachments) {
    if (!a.val.r2Key.startsWith(expectedPrefix)) {
      return fail({
        code: 'forbidden_r2_key',
        message: 'An attached file does not belong to you.',
        fieldKey: a.fieldKey,
      });
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
    return fail({
      code: 'r2_key_not_found',
      message: 'An attached file could not be found in storage.',
      fieldKey: missing.fieldKey,
      details: { r2Key: missing.r2Key },
    });
  }

  // ── Reference-clip durations, probed from the bytes in R2 ──────
  //
  // Video durations feed BILLING (`inputVideoSeconds` scales the
  // charge), so an unreadable clip is a rejection, never a zero —
  // otherwise understating the input is free money against us. Audio
  // durations only guard the provider's own caps, which it enforces
  // AFTER we have debited; catching a violation here turns a
  // failed-and-refunded job into an instant 422.
  let inputVideoSeconds = 0;
  if (model.referenceVideo && videoRefs.length > 0) {
    const budget = model.referenceVideo;
    // BytePlus raises the floor for edit tasks: the clip being edited
    // must be at least 4s (general references allow 2s).
    const minClip = body.task === 'edit' ? Math.max(4, budget.minClipSeconds) : budget.minClipSeconds;
    const durations = await Promise.all(
      videoRefs.map((a) =>
        probeVideoDurationSeconds(ctx.uploadsBucket, a.val.r2Key, a.val.sizeBytes),
      ),
    );
    for (let i = 0; i < videoRefs.length; i++) {
      const seconds = durations[i];
      const fieldKey = videoRefs[i]!.fieldKey;
      if (seconds == null) {
        return fail({
          code: 'video_reference_unreadable',
          message:
            'A video reference could not be read. Use a standard (non-fragmented) MP4 or MOV file.',
          fieldKey,
        });
      }
      if (seconds < minClip || seconds > budget.maxClipSeconds) {
        return fail({
          code: 'video_reference_duration',
          message: `${body.task === 'edit' ? 'Videos to edit' : 'Video references'} must be ${minClip}–${budget.maxClipSeconds} seconds long.`,
          fieldKey,
          details: { seconds: Math.round(seconds * 10) / 10 },
        });
      }
      inputVideoSeconds += seconds;
    }
    if (inputVideoSeconds > budget.maxTotalSeconds) {
      return fail({
        code: 'video_references_too_long',
        message: `Video references can total at most ${budget.maxTotalSeconds} seconds for this model.`,
        details: { maxTotalSeconds: budget.maxTotalSeconds },
      });
    }
  }
  if (model.referenceAudio && audioRefs.length > 0) {
    const budget = model.referenceAudio;
    let totalAudio = 0;
    const durations = await Promise.all(
      audioRefs.map((a) =>
        probeAudioDurationSeconds(
          ctx.uploadsBucket,
          a.val.r2Key,
          a.val.sizeBytes,
          a.val.mimeType,
        ),
      ),
    );
    for (let i = 0; i < audioRefs.length; i++) {
      const seconds = durations[i];
      const fieldKey = audioRefs[i]!.fieldKey;
      if (seconds == null) {
        return fail({
          code: 'audio_reference_unreadable',
          message: 'An audio reference could not be read. Use a standard MP3 or WAV file.',
          fieldKey,
        });
      }
      if (seconds < budget.minClipSeconds || seconds > budget.maxClipSeconds) {
        return fail({
          code: 'audio_reference_duration',
          message: `Audio references must be ${budget.minClipSeconds}–${budget.maxClipSeconds} seconds long.`,
          fieldKey,
          details: { seconds: Math.round(seconds * 10) / 10 },
        });
      }
      totalAudio += seconds;
    }
    if (totalAudio > budget.maxTotalSeconds) {
      return fail({
        code: 'audio_references_too_long',
        message: `Audio references can total at most ${budget.maxTotalSeconds} seconds for this model.`,
        details: { maxTotalSeconds: budget.maxTotalSeconds },
      });
    }
  }

  // ── Aspect ratio ───────────────────────────────────────────────
  if (body.aspectRatio !== undefined && model.allowedAspectRatios.length > 0) {
    if (!model.allowedAspectRatios.includes(body.aspectRatio)) {
      return fail({
        code: 'aspect_not_allowed',
        message: `Aspect ratio "${body.aspectRatio}" is not supported by this model.`,
        details: { submitted: body.aspectRatio, allowed: model.allowedAspectRatios },
      });
    }
  }

  // ── Duration ───────────────────────────────────────────────────
  if (body.duration !== undefined) {
    if (model.kind !== 'video' || model.allowedDurations.length === 0) {
      return fail({
        code: 'duration_not_allowed',
        message: 'This model does not support a duration setting.',
        details: { submitted: body.duration },
      });
    }
    if (!model.allowedDurations.includes(body.duration)) {
      return fail({
        code: 'duration_not_allowed',
        message: `Duration ${body.duration}s is not supported by this model.`,
        details: { submitted: body.duration, allowed: model.allowedDurations },
      });
    }
    // Kling O1: a bare start frame collapses the legal durations. A 422
    // here beats a provider rejection after the debit.
    if (
      model.bareStartFrameDurations &&
      body.startFrame &&
      !body.endFrame &&
      body.references.length === 0 &&
      !model.bareStartFrameDurations.includes(body.duration)
    ) {
      return fail({
        code: 'duration_not_allowed',
        message: `With only a start frame, this model supports ${model.bareStartFrameDurations.join(
          's or ',
        )}s clips.`,
        details: { submitted: body.duration, allowed: [...model.bareStartFrameDurations] },
      });
    }
  }

  // Credit balance is checked by the ROUTE after this returns: the cost
  // depends on `inputVideoSeconds`, which only exists once the clips
  // above have been probed.
  return { ok: { inputVideoSeconds } };
}
