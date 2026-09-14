/**
 * Why a job failed, in terms a person can act on.
 *
 * A provider failure used to reach the user as the provider's raw text —
 * `Seedance API 400 Bad Request: {"error":{"code":"InputImageSensitive…` —
 * in English on the Arabic site too. The worker now recognises the causes
 * a user can do something about and stores a stable `reason` next to the
 * message; the apps translate the reason, and anything unrecognised keeps
 * the provider's own text as before.
 *
 * Lives in `@clickfy/types` so the worker (which detects) and the apps
 * (which translate) share one list of reasons.
 */

export const JOB_ERROR_REASONS = ['video_task_mismatch', 'input_real_person'] as const;

export type JobErrorReason = (typeof JOB_ERROR_REASONS)[number];

/**
 * English copy stored in `JobError.message` for a recognised reason — what
 * clients that don't translate reasons (mobile today) show.
 */
export const JOB_ERROR_MESSAGES: Record<JobErrorReason, string> = {
  video_task_mismatch:
    'This prompt edits or continues your video, which References mode can’t do. Switch to Edit video or Extend video and try again.',
  input_real_person:
    'A reference photo or video appears to show a real person, which this model doesn’t accept. Try one without a recognisable person.',
};

/**
 * The reason behind a provider error message, when it is one we explain.
 *
 *   - `video_task_mismatch` — Seedance 2.5 classified the prompt as an edit
 *     or extend while we declared a References task
 *     (`InvalidParameter.TaskTypeMismatch`), or classified it under `auto`
 *     and the request's shape broke that task's rules
 *     (`InvalidParameter.TaskTypeConstraint`). Both surface asynchronously,
 *     after the task was queued.
 *   - `input_real_person` — BytePlus refused a reference because it shows a
 *     real person (`InputImageSensitiveContentDetected.PrivacyInformation`,
 *     and the video equivalent). Every failed Seedance job in production up
 *     to Sept 2026 was this.
 */
export function jobErrorReasonFor(providerMessage: string): JobErrorReason | undefined {
  if (/TaskType(Mismatch|Constraint)/.test(providerMessage)) return 'video_task_mismatch';
  if (/SensitiveContentDetected\.PrivacyInformation/.test(providerMessage)) return 'input_real_person';
  return undefined;
}

export function isJobErrorReason(value: unknown): value is JobErrorReason {
  return typeof value === 'string' && (JOB_ERROR_REASONS as readonly string[]).includes(value);
}
