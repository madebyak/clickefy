/**
 * Turns a failed job's `reason` + `params` into the sentence the user
 * reads — title, body and whether the fix is in their hands — in the
 * viewer's language. The worker only ever stores English
 * (`jobErrorMessage`); this is the translating twin of that function.
 *
 * The attachment label in `params.item` arrives in the worker's English
 * ("Image 2", "Start frame") and is re-labelled here, so an Arabic reader
 * sees «الصورة 2».
 */

import { isJobErrorReason, type JobErrorReason } from "@clickfy/types";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface JobErrorInput {
  reason?: string;
  params?: Record<string, string | number | undefined>;
  /** The stored English sentence, shown only when the reason is unknown. */
  message?: string;
  refunded?: boolean;
}

export interface JobErrorCopy {
  title: string;
  body: string;
  /** The fix is an attachment, the prompt or a setting — not a retry. */
  fixable: boolean;
  /** The provider's / worker's own sentence, for the details view. */
  technical?: string;
}

const SIDE = new Set(["width", "height"]);

function localisedItem(t: Translate, item: unknown, kind: unknown): string {
  if (typeof item === "string") {
    const m = /^(Image|Video|Audio) (\d+)$/.exec(item);
    if (m) return t(`jobError.item.${m[1]!.toLowerCase()}`, { n: Number(m[2]) });
    if (item === "Start frame") return t("jobError.item.startFrame");
    if (item === "End frame") return t("jobError.item.endFrame");
    return item;
  }
  const k = kind === "video" || kind === "audio" ? kind : "image";
  return t(`jobError.item.the.${k}`);
}

export function describeJobError(t: Translate, input: JobErrorInput): JobErrorCopy {
  const reason: JobErrorReason | undefined = isJobErrorReason(input.reason) ? input.reason : undefined;
  if (!reason) {
    return {
      title: t("jobError.unknown.title"),
      body: t("jobError.unknown.body"),
      fixable: false,
      technical: input.message,
    };
  }
  const p = input.params ?? {};
  const item = localisedItem(t, p.item, p.kind);
  const side = typeof p.side === "string" && SIDE.has(p.side) ? p.side : undefined;
  const value = typeof p.value === "number" ? p.value : undefined;
  const min = typeof p.min === "number" ? p.min : undefined;
  const max = typeof p.max === "number" ? p.max : undefined;
  const kind = p.kind === "audio" ? "audio" : p.kind === "video" ? "video" : "image";
  const fixable = reason.startsWith("input_") || reason === "video_task_mismatch";
  const title = t(`jobError.${reason}.title`, { kind });

  let body: string;
  switch (reason) {
    case "input_media_too_small":
      body =
        side && value !== undefined && min !== undefined
          ? t("jobError.input_media_too_small.bodySized", { item, side, value, min })
          : t("jobError.input_media_too_small.body", { item, min: min ?? 300 });
      break;
    case "input_media_too_large":
      body =
        side && value !== undefined && max !== undefined
          ? t("jobError.input_media_too_large.bodySized", { item, side, value, max })
          : t("jobError.input_media_too_large.body", { item });
      break;
    case "input_video_too_long":
      body = max !== undefined ? t("jobError.input_video_too_long.bodyMax", { max }) : t("jobError.input_video_too_long.body");
      break;
    case "input_prompt_too_long":
      body = max !== undefined ? t("jobError.input_prompt_too_long.bodyMax", { max }) : t("jobError.input_prompt_too_long.body");
      break;
    case "output_copyright":
      body = kind === "audio" ? t("jobError.output_copyright.bodyAudio") : t("jobError.output_copyright.body");
      break;
    default:
      body = t(`jobError.${reason}.body`, { item, kind, max: max ?? 1080 });
  }
  return { title, body, fixable, technical: input.message };
}

/** Submit-time refusals (HTTP 422) that carry the same specifics as a failed job. */
export const SUBMIT_CODE_REASON: Record<string, JobErrorReason> = {
  image_too_small: "input_media_too_small",
  image_too_large: "input_media_too_large",
  image_bad_shape: "input_media_bad_shape",
  prompt_too_long: "input_prompt_too_long",
};
