/**
 * Turns a failed job's `reason` + `params` into the sentence the user
 * reads — title, body and whether the fix is in their hands — in the
 * app's language. Mirrors `apps/web/lib/job-error-copy.ts`; the worker
 * stores English only (`jobErrorMessage` in @clickfy/types).
 *
 * Keys live under `create:jobError.*`. i18next has no ICU `select`, so
 * the sided sentences are separate keys (bodyWidth / bodyHeight) and
 * the titles are per media kind (titleImage / titleVideo / titleAudio).
 */

import type { TFunction } from 'i18next';

import { isJobErrorReason, type JobErrorReason } from '@clickfy/types';

export interface JobErrorInput {
  errorReason?: string;
  errorParams?: Record<string, string | number | undefined>;
  /** The stored English sentence, shown only when the reason is unknown. */
  errorMessage?: string;
  refunded?: boolean;
}

export interface JobErrorCopy {
  title: string;
  body: string;
  /** The fix is an attachment, the prompt or a setting — not a retry. */
  fixable: boolean;
  /** Appended line when the credits came back. */
  refundedLine?: string;
}

const K = 'create:jobError';

function localisedItem(t: TFunction, item: unknown, kind: unknown): string {
  if (typeof item === 'string') {
    const m = /^(Image|Video|Audio) (\d+)$/.exec(item);
    if (m) return t(`${K}.item.${m[1]!.toLowerCase()}`, { n: Number(m[2]) });
    if (item === 'Start frame') return t(`${K}.item.startFrame`);
    if (item === 'End frame') return t(`${K}.item.endFrame`);
    return item;
  }
  const k = kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Image';
  return t(`${K}.item.the${k}`);
}

export function describeJobError(t: TFunction, input: JobErrorInput): JobErrorCopy {
  const refundedLine = input.refunded ? t(`${K}.refunded`) : undefined;
  const reason: JobErrorReason | undefined = isJobErrorReason(input.errorReason)
    ? input.errorReason
    : undefined;
  if (!reason) {
    return { title: t(`${K}.unknownTitle`), body: t(`${K}.unknownBody`), fixable: false, refundedLine };
  }
  const p = input.errorParams ?? {};
  const item = localisedItem(t, p.item, p.kind);
  const side = p.side === 'width' || p.side === 'height' ? p.side : undefined;
  const value = typeof p.value === 'number' ? p.value : undefined;
  const min = typeof p.min === 'number' ? p.min : undefined;
  const max = typeof p.max === 'number' ? p.max : undefined;
  const kindTitle = p.kind === 'video' ? 'Video' : p.kind === 'audio' ? 'Audio' : 'Image';
  const fixable = reason.startsWith('input_') || reason === 'video_task_mismatch';
  const sided = (base: string) =>
    side && value !== undefined
      ? t(`${K}.${base}.${side === 'width' ? 'bodyWidth' : 'bodyHeight'}`, { item, value, min, max })
      : t(`${K}.${base}.body`, { item, min: min ?? 300 });

  let title = t(`${K}.${reason}.title`, { defaultValue: '' });
  let body: string;
  switch (reason) {
    case 'input_media_too_small':
    case 'input_media_too_large':
      title = t(`${K}.${reason}.title${kindTitle}`);
      body = sided(reason);
      break;
    case 'input_video_too_long':
    case 'input_prompt_too_long':
      body = max !== undefined ? t(`${K}.${reason}.bodyMax`, { max }) : t(`${K}.${reason}.body`);
      break;
    case 'output_copyright':
      body = p.kind === 'audio' ? t(`${K}.${reason}.bodyAudio`) : t(`${K}.${reason}.body`);
      break;
    default:
      body = t(`${K}.${reason}.body`, { item, max: max ?? 1080 });
  }
  return { title, body, fixable, refundedLine };
}

/** Submit-time refusals (HTTP 422) that carry the same specifics as a failed job. */
export const SUBMIT_CODE_REASON: Record<string, JobErrorReason> = {
  image_too_small: 'input_media_too_small',
  image_too_large: 'input_media_too_large',
  image_bad_shape: 'input_media_bad_shape',
  prompt_too_long: 'input_prompt_too_long',
};
