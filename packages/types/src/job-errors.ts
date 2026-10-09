/**
 * Why a job failed, in terms a person can act on.
 *
 * A provider failure used to reach the user as the provider's raw text —
 * `Seedance API 400 Bad Request: {"error":{"code":"InputImageSensitive…` —
 * in English on the Arabic site too. The worker recognises the cause and
 * stores a stable `reason` plus the numbers that make it specific (which
 * attachment, which side, how many pixels, what the limit is); the apps
 * translate the reason and fill in the numbers, `message` carries the
 * English sentence for clients that don't, and the provider's own words
 * go to `detail` for admins only.
 *
 * Lives in `@clickfy/types` so the worker (which detects) and the apps
 * (which translate) share one list of reasons. Every pattern below is
 * taken from a real failed job in production (audit of 2026-10-09).
 */

import type { MediaKind } from './json-types';

export const JOB_ERROR_REASONS = [
  // Inputs the provider refused.
  'input_real_person',
  'input_media_too_small',
  'input_media_too_large',
  'input_media_bad_shape',
  'input_video_too_long',
  'input_upscale_source_too_large',
  'input_media_flagged',
  'input_prompt_too_long',
  'video_task_mismatch',
  // Outputs the provider refused to hand over.
  'output_copyright',
  'output_flagged',
  'output_empty',
  // Nobody's fault; a retry is the answer.
  'provider_busy',
  'provider_timeout',
  // Ours.
  'system',
] as const;

export type JobErrorReason = (typeof JOB_ERROR_REASONS)[number];

/** The specifics a reason's copy is built from. Every field is optional. */
export interface JobErrorParams {
  /** Which attachment, e.g. "Image 2", "Start frame" — already labelled. */
  item?: string;
  kind?: MediaKind;
  side?: 'width' | 'height';
  /** The offending measurement (pixels, seconds, characters, a ratio). */
  value?: number;
  min?: number;
  max?: number;
}

export interface JobErrorExplanation {
  reason: JobErrorReason;
  params: JobErrorParams;
}

/**
 * Maps a provider content index (Seedance's `content[3]`) to the label of
 * the attachment that went there. Index 0 is the prompt text; the worker
 * knows what followed it.
 */
export type ContentItemLabeller = (contentIndex: number) => string | undefined;

const num = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

function contentItem(raw: string, label?: ContentItemLabeller): string | undefined {
  const m = /content\[(\d+)\]/.exec(raw);
  if (!m || !label) return undefined;
  return label(Number(m[1]));
}

function kindOf(raw: string): MediaKind | undefined {
  if (/video/i.test(raw) && !/image/i.test(raw)) return 'video';
  if (/audio/i.test(raw)) return 'audio';
  if (/image/i.test(raw)) return 'image';
  return undefined;
}

/**
 * The reason behind a provider error message, when it is one we explain,
 * with the numbers the message carried. Order matters: the most specific
 * patterns come first.
 */
export function explainProviderError(
  raw: string,
  label?: ContentItemLabeller,
): JobErrorExplanation | undefined {
  const item = contentItem(raw, label);

  // ── Seedance 2.5 task shape ────────────────────────────────────
  if (/TaskType(Mismatch|Constraint)/.test(raw)) {
    return { reason: 'video_task_mismatch', params: {} };
  }

  // ── Inputs ─────────────────────────────────────────────────────
  if (/SensitiveContentDetected\.PrivacyInformation/.test(raw)) {
    return { reason: 'input_real_person', params: { item, kind: kindOf(raw) ?? 'image' } };
  }
  // "expected the width to be at least 300px, but received a 280x602px image"
  let m = /expected the (width|height) to be at (least|most) (\d+)px, but received a (\d+)x(\d+)px/.exec(raw);
  if (m) {
    const side = m[1] as 'width' | 'height';
    const value = side === 'width' ? num(m[4]) : num(m[5]);
    const limit = num(m[3]);
    return m[2] === 'least'
      ? { reason: 'input_media_too_small', params: { item, kind: 'image', side, value, min: limit } }
      : { reason: 'input_media_too_large', params: { item, kind: 'image', side, value, max: limit } };
  }
  // "the parameter image pixel count ... must be greater than or equal to 90000"
  m = /(image|video) pixel count .*?greater than or equal to (\d+)/.exec(raw);
  if (m) {
    const px = num(m[2]);
    return {
      reason: 'input_media_too_small',
      params: { item, kind: m[1] as MediaKind, min: px ? Math.round(Math.sqrt(px)) : undefined },
    };
  }
  // "expected the aspect ratio to be between 0.39 and 2.50, but received image with aspect ratio: 2.94"
  m = /expected the aspect ratio to be between ([\d.]+) and ([\d.]+), but received .*?aspect ratio: ([\d.]+)/.exec(raw);
  if (m) {
    return {
      reason: 'input_media_bad_shape',
      params: { item, kind: 'image', min: num(m[1]), max: num(m[2]), value: num(m[3]) },
    };
  }
  // "video total duration (seconds) specified in the request must be less than or equal to 15"
  m = /video total duration .*?(?:less than or equal to|le|<=)\s*(\d+)/.exec(raw);
  if (m || /video total duration/.test(raw)) {
    return { reason: 'input_video_too_long', params: { kind: 'video', max: num(m?.[1]) } };
  }
  // fal upscaler: "must have one side of length less than 1080 pixels for 1080p upscale"
  m = /one side of length less than (\d+) pixels for (\d+)p upscale/.exec(raw);
  if (m) {
    return { reason: 'input_upscale_source_too_large', params: { kind: 'video', max: num(m[1]) } };
  }
  m = /Input(Image|Video|Audio)SensitiveContentDetected/.exec(raw);
  if (m) {
    return { reason: 'input_media_flagged', params: { item, kind: m[1]!.toLowerCase() as MediaKind } };
  }
  // Kling: "prompt: size must be between 0 and 2500"
  m = /prompt: size must be between \d+ and (\d+)/.exec(raw);
  if (m) {
    return { reason: 'input_prompt_too_long', params: { max: num(m[1]) } };
  }

  // ── Outputs ────────────────────────────────────────────────────
  m = /Output(Audio|Video|Image)SensitiveContentDetected\.PolicyViolation/.exec(raw);
  if (m) {
    return { reason: 'output_copyright', params: { kind: m[1]!.toLowerCase() as MediaKind } };
  }
  if (/IMAGE_RECITATION|RECITATION/.test(raw)) {
    return { reason: 'output_copyright', params: { kind: 'image' } };
  }
  m = /Output(Audio|Video|Image)SensitiveContentDetected/.exec(raw);
  if (m) {
    return { reason: 'output_flagged', params: { kind: m[1]!.toLowerCase() as MediaKind } };
  }
  if (/moderation_blocked|safety system|SAFETY|PROHIBITED_CONTENT|content policy/i.test(raw)) {
    return { reason: 'output_flagged', params: {} };
  }
  if (/returned no (images|video output)|no video output|content\.video_url is missing/i.test(raw)) {
    return { reason: 'output_empty', params: {} };
  }

  // ── Transient ──────────────────────────────────────────────────
  if (
    /high demand|UNAVAILABLE|\b50[234]\b|Gateway Time-?out|Connection terminated|fetch failed|ECONNRESET|ETIMEDOUT|Timeout while downloading|rate limit|too many requests|\b429\b/i.test(
      raw,
    )
  ) {
    return { reason: 'provider_busy', params: {} };
  }
  if (/took too long|timed out/i.test(raw)) {
    return { reason: 'provider_timeout', params: {} };
  }

  // ── Ours: configuration, credentials, wiring ───────────────────
  if (
    /AccountOverdue|overdue balance|insufficient balance|Invalid video_url|is not supported with last frame|not registered|\b1002\b|Failed to download the file|no URL/i.test(
      raw,
    )
  ) {
    return { reason: 'system', params: {} };
  }
  return undefined;
}

/** Backwards-compatible: the reason alone. */
export function jobErrorReasonFor(providerMessage: string): JobErrorReason | undefined {
  return explainProviderError(providerMessage)?.reason;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const itemOr = (p: JobErrorParams, fallback: string) => p.item ?? fallback;
const kindWord = (p: JobErrorParams, fallback = 'file') => p.kind ?? fallback;

/**
 * English copy for a reason, with its specifics filled in — what
 * `JobError.message` stores, and what clients without translations show.
 * The apps keep their own translated copies of these sentences.
 */
export function jobErrorMessage(reason: JobErrorReason, p: JobErrorParams = {}): string {
  switch (reason) {
    case 'video_task_mismatch':
      return 'This prompt edits or continues your video, which References mode can’t do. Switch to Edit video or Extend video and try again.';
    case 'input_real_person':
      return `${cap(itemOr(p, `a reference ${kindWord(p, 'photo')}`))} appears to show a real person, which this model doesn’t accept. Use one without a recognisable person.`;
    case 'input_media_too_small':
      if (p.side && p.value !== undefined && p.min !== undefined) {
        return `${cap(itemOr(p, kindWord(p, 'image')))} ${p.side} of ${p.value} pixels is too low. Minimum ${p.side} is ${p.min} pixels.`;
      }
      return `${cap(itemOr(p, `the ${kindWord(p, 'image')}`))} is too small.${p.min !== undefined ? ` Minimum size is ${p.min}×${p.min} pixels.` : ''}`;
    case 'input_media_too_large':
      if (p.side && p.value !== undefined && p.max !== undefined) {
        return `${cap(itemOr(p, kindWord(p, 'image')))} ${p.side} of ${p.value} pixels is too high. Maximum ${p.side} is ${p.max} pixels.`;
      }
      return `${cap(itemOr(p, `the ${kindWord(p, 'image')}`))} is too large.${p.max !== undefined ? ` Maximum size is ${p.max} pixels on each side.` : ''}`;
    case 'input_media_bad_shape':
      return `${cap(itemOr(p, `the ${kindWord(p, 'image')}`))} is too wide or too tall${p.value !== undefined ? ` (${p.value}:1)` : ''}. This model takes shapes between 1:2.5 and 2.5:1.`;
    case 'input_video_too_long':
      return `Your video references are too long.${p.max !== undefined ? ` This model takes up to ${p.max} seconds of video in total.` : ''} Trim them or attach fewer.`;
    case 'input_upscale_source_too_large':
      return `This video is already ${p.max ?? 1080}p or larger, so there is nothing to upscale at that size. Pick a higher output resolution or a smaller source.`;
    case 'input_media_flagged':
      return `${cap(itemOr(p, `a reference ${kindWord(p)}`))} was flagged by the model’s content filter. Try a different ${kindWord(p)}.`;
    case 'input_prompt_too_long':
      return `Your prompt is too long for this model.${p.max !== undefined ? ` Keep it under ${p.max} characters.` : ''}`;
    case 'output_copyright':
      return p.kind === 'audio'
        ? 'The generated sound was blocked for resembling copyrighted music. Try again with sound off, or describe original sound effects instead of a song.'
        : 'The result was blocked for resembling copyrighted material. Change the prompt or the references and try again.';
    case 'output_flagged':
      return 'The result was blocked by the model’s safety filter. Adjust the prompt or the references and try again.';
    case 'output_empty':
      return 'The model returned nothing this time. Try again, or reword the prompt.';
    case 'provider_busy':
      return 'The model is overloaded right now. Please try again in a few minutes.';
    case 'provider_timeout':
      return 'The model took too long to respond. Please try again.';
    case 'system':
      return 'Something went wrong on our side. Please try again — if it keeps happening, contact support.';
  }
}

/** The reasons whose fix is in the user's hands (an attachment, the prompt, a setting). */
export function isUserFixableReason(reason: JobErrorReason): boolean {
  return reason.startsWith('input_') || reason === 'video_task_mismatch';
}

export function isJobErrorReason(value: unknown): value is JobErrorReason {
  return typeof value === 'string' && (JOB_ERROR_REASONS as readonly string[]).includes(value);
}
