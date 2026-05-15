/**
 * SDK-facing types — what the mobile/web apps actually consume.
 * These are projections of @clickfy/types — sometimes thinner (catalog list)
 * sometimes augmented (user-facing fields the admin doesn't store).
 */

import type { TemplateInput } from '@clickfy/types';

export type TemplateKind = 'image' | 'video' | 'set';

export interface CatalogCategory {
  id: string;
  label: string;
  /** Hero photo URI (small, ~200w). `null` for the "All" pseudo-category. */
  imageUri: string | null;
  /** Brand swatch behind the circular thumb */
  color: string;
}

/**
 * What the user receives back when they generate this template.
 * One entry per media class — an `image_then_video` pipeline that
 * emits both gets `[{ image, 1 }, { video, 1 }]`.
 */
export interface TemplateOutputSummary {
  kind: 'image' | 'video';
  count: number;
}

export interface CatalogTemplate {
  id: string;
  title: string;
  /** Marketing copy shown on the template detail page. Empty string when omitted. */
  description: string;
  /**
   * Primary category id this template belongs to.
   * @deprecated Use `categoryIds[0]` — kept on the wire for legacy
   *             single-category clients.
   */
  categoryId: string;
  /**
   * Full ordered category membership: primary first, then 0..2 extras.
   * A template can appear in multiple categories; UI surfaces it in
   * the primary's rail only (the API enforces cross-rail dedup on
   * the home feed).
   */
  categoryIds: string[];
  kind: TemplateKind;
  /** Cover image URI (~600w) — used as poster behind the preview video too */
  coverImage: string;
  /**
   * Optional auto-playing preview clip (4–8s, muted, looped) shown by the
   * mobile app instead of the static cover. Accepts:
   *   - a remote URL (`https://…/clip.mp4`), or
   *   - a symbolic local key the mobile app resolves through its local
   *     asset map (e.g. `local:spin`).
   * Image-kind templates leave this undefined.
   */
  previewVideo?: string;
  /**
   * Optional carousel images shown on the template detail screen.
   * When `gallery.length > 1`, the hero turns into a paged swiper with
   * dot indicators; otherwise the detail falls back to `coverImage` or
   * `previewVideo`. Typically populated for `kind: 'set'` templates.
   */
  gallery?: string[];
  /** Aspect ratio as W/H string, e.g. "4/5" */
  aspect: string;
  /** Credits required to generate */
  credits: number;
  /** True if the template is featured (hero placement) */
  featured?: boolean;
  /** User-provided inputs definition (from admin) — undefined in light list views */
  userInputs?: TemplateInput[];
  /** Whether the user can pick aspect ratio at generation time */
  userCanChooseAspectRatio?: boolean;
  /**
   * What the user receives back. Undefined in light list views; the
   * detail-page fetch always populates it.
   */
  outputs?: TemplateOutputSummary[];
  /**
   * Whether the current authenticated user has saved this template.
   * Undefined when called unauthenticated (catalog reads are public).
   */
  isFavorited?: boolean;
}

/**
 * A single output of a generation — image or video, with the
 * fully-resolved CDN URL ready to drop into an `<Image>` or
 * `<Video>` component. The kind is essential for the result page:
 * an image gets `<Image>`, a video gets `<Video>`. Saved to the
 * camera roll, both work through `MediaLibrary.saveToLibraryAsync`.
 */
export interface JobOutput {
  url: string;
  kind: 'image' | 'video';
}

/**
 * A user's past generation as it appears in Projects/Library.
 *
 * The shape carries enough denormalised template info that the
 * Projects screen renders without a second lookup — important
 * because templates can be archived / renamed without invalidating
 * a user's history. We keep the bare-template id around so deep
 * links into the editor still work when the template still exists.
 */
export interface UserProject {
  id: string;
  templateId: string;
  /** Inline template summary — sourced from the row's frozen version. */
  templateName: string;
  templateCoverImage: string;
  templateKind: 'image' | 'video' | 'set';
  /**
   * Human title shown in lists. Currently mirrors `templateName` but
   * lives separately so we can promote a custom job title later
   * (e.g. user-typed memo) without a schema change.
   */
  title: string;
  /** ISO timestamp; client formats `whenLabel` so it stays fresh. */
  createdAt: string;
  /** Friendly relative time, e.g. "2 min ago". Computed by the SDK. */
  whenLabel: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  /** Number of final outputs (only meaningful when `status==='ready'`). */
  count: number;
  /**
   * Final-stage outputs, each tagged with `kind` so the UI knows
   * to render <Image> or <Video>. Empty array while still in flight.
   */
  outputs: JobOutput[];
}

// ─── Auth ────────────────────────────────────────────────────────────

export type AuthProvider = 'apple' | 'google' | 'email';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUri?: string;
  /** Display initials when no avatar */
  initials: string;
}

export interface UserPlan {
  /** Plan tier label ("Free", "Pro", "Studio") */
  tier: string;
  /** Whether user has any active subscription */
  isPro: boolean;
  /** Credits remaining */
  credits: number;
  /** Resets-at ISO date */
  renewsAt?: string;
}

export interface AuthSession {
  user: User;
  plan: UserPlan;
}

/**
 * Lifecycle handle for an outstanding OTP challenge — issued by
 * `auth.requestOtp` and `auth.signUp`, consumed by `auth.verifyOtp` and
 * `auth.resendOtp`.
 *
 * The `requestId` should be treated as opaque by the UI. `expiresAt` lets
 * the verify screen render a live countdown without polling the server.
 */
export interface OtpChallenge {
  requestId: string;
  /** Where the (fake or real) code was sent. */
  email: string;
  /** ISO date string for when the code stops being valid. */
  expiresAt: string;
  /** Seconds the UI should wait before allowing a resend. */
  resendCooldownSec: number;
}

/** Discriminated error codes thrown by the auth client. */
export type AuthErrorCode =
  | 'INVALID_EMAIL'
  | 'INVALID_NAME'
  | 'RATE_LIMITED'
  | 'REQUEST_NOT_FOUND'
  | 'CODE_EXPIRED'
  | 'CODE_INVALID'
  | 'COOLDOWN_ACTIVE'
  | 'PROVIDER_CANCELLED'
  | 'UNKNOWN';

/**
 * Typed error thrown by `MockAuth` / `HttpAuth`. Use `instanceof` + the
 * `code` field to render specific messages in the UI.
 *
 * NOTE: don't extend this with new codes ad-hoc — keep the list above
 * exhaustive so screens get exhaustiveness checks from TS.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AuthError';
    this.code = code;
  }
}

// ─── Generations ─────────────────────────────────────────────────────

export interface GenerationRequest {
  templateId: string;
  /** Map of fieldKey → user-provided value (text strings or local file URIs) */
  inputs: Record<string, string>;
  /** Optional aspect ratio override */
  aspectRatio?: string;
}

/**
 * Job-submission shape sent to `POST /v1/jobs`. Mirrors the worker's
 * `JobInputValue` discriminated union exactly so the mobile app can
 * pass the same object it already keeps in form state (text values +
 * the R2 keys returned from `uploads.uploadUserAsset()`).
 *
 * One submission produces ONE job → ONE result. The 1/2/4 "count"
 * picker was removed from the mobile UI in B2 — variation count is
 * not part of the contract.
 */
export type JobInputValue =
  | { kind: 'image'; r2Key: string; mimeType: string; sizeBytes: number }
  | { kind: 'video'; r2Key: string; mimeType: string; sizeBytes: number }
  | { kind: 'text'; value: string };

export interface JobSubmission {
  templateId: string;
  inputs: Record<string, JobInputValue>;
  options?: {
    aspectRatio?: string;
  };
  /**
   * Optional client-generated UUID. When the same key is submitted
   * twice (e.g. retry after a flaky network), the server returns the
   * original job without re-charging credits.
   */
  idempotencyKey?: string;
}

export interface JobSubmissionResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  /** Remaining credits AFTER this submission's debit. */
  creditsRemaining: number;
  /** True when the server returned the original job for an idempotent retry. */
  idempotent?: boolean;
}

/**
 * Structured error returned by `POST /v1/jobs` (and surfaced as
 * `JobSubmissionError` on the client). The mobile app renders
 * different copy per `code`.
 */
export type JobSubmissionErrorCode =
  | 'template_not_found'
  | 'template_not_published'
  | 'input_missing'
  | 'input_invalid_type'
  | 'input_text_too_long'
  | 'input_select_invalid_option'
  | 'forbidden_r2_key'
  | 'r2_key_not_found'
  | 'unsupported_mime'
  | 'aspect_not_allowed'
  | 'insufficient_credits'
  | 'unauthenticated'
  | 'r2_not_configured'
  | 'network_error';

export class JobSubmissionError extends Error {
  readonly code: JobSubmissionErrorCode;
  readonly fieldKey?: string;
  readonly details?: Record<string, unknown>;
  readonly httpStatus?: number;
  constructor(
    code: JobSubmissionErrorCode,
    message: string,
    extras?: { fieldKey?: string; details?: Record<string, unknown>; httpStatus?: number },
  ) {
    super(message);
    this.name = 'JobSubmissionError';
    this.code = code;
    this.fieldKey = extras?.fieldKey;
    this.details = extras?.details;
    this.httpStatus = extras?.httpStatus;
  }
}

export interface GenerationProgress {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  /** 0–1 within the active stage */
  stageProgress: number;
  /** 1-based current stage index */
  stageIndex: number;
  /** Total stages */
  stageCount: number;
  /** Human label, e.g. "Generating product hero" */
  stageLabel: string;
  /** Final outputs once completed (image + video mixed). */
  outputs?: JobOutput[];
  /** Error message when failed */
  error?: string;
}

// ─── Generic API result envelope ─────────────────────────────────────

export interface Paginated<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ApiClientOptions {
  /** Inject a custom delay simulator (mock client only) */
  delay?: { min: number; max: number };
  /** Inject a random error rate 0–1 (mock client only) */
  errorRate?: number;
}
