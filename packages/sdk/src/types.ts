/**
 * SDK-facing types — what the mobile/web apps actually consume.
 * These are projections of @clickfy/types — sometimes thinner (catalog list)
 * sometimes augmented (user-facing fields the admin doesn't store).
 */

import type { TemplateInput } from '@clickfy/types';

export type TemplateKind = 'image' | 'video' | 'set' | 'video_image';

export interface CatalogCategory {
  id: string;
  label: string;
  /** Hero photo URI (small, ~200w). `null` for the "All" pseudo-category. */
  imageUri: string | null;
  /** Brand swatch behind the circular thumb */
  color: string;
  /**
   * `null` for top-level (root) categories; the parent id for
   * sub-categories. Mobile uses this to filter the chip rail to
   * roots only and surface sub-categories via the parent's drill-down.
   */
  parentId?: string | null;
  /**
   * Direct sub-categories, attached server-side. Populated on roots,
   * `[]` (or omitted) on sub-categories themselves. Optional so
   * pre-feature callers compiling against this type keep working.
   */
  children?: CatalogCategory[];
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
  /**
   * Native pixel width of the asset, when known. Image outputs always
   * carry this (sourced from the stored `MediaRef`); video outputs may
   * leave it undefined until Cloudflare Stream reports dimensions back
   * through the worker. Consumers should never assume presence.
   */
  width?: number;
  /** Native pixel height, paired with `width`. */
  height?: number;
  /**
   * Convenience: `width / height` when both are present. The API computes
   * this server-side so mobile doesn't have to and can fall back to a
   * default (e.g. 9:16 for video) when this field is missing.
   */
  aspectRatio?: number;
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
  /** Null for prompt-first "create" generations (they have no template). */
  templateId: string | null;
  /**
   * Inline template summary. For a template job it's the template's name +
   * cover; for a create job (`source==='user'`) it's the model name and an
   * empty cover (the client falls back to `outputs[0]`).
   */
  templateName: string;
  templateCoverImage: string;
  templateKind: 'image' | 'video' | 'set' | 'video_image';
  /**
   * Human title shown in lists. For template jobs it mirrors
   * `templateName`; for create jobs it's the user's prompt.
   */
  title: string;
  /** Provenance — `'user'` drives the Projects "Custom" badge. */
  source: 'user' | 'template';
  /**
   * Web-studio project the job files its outputs into; null for mobile
   * jobs (flat history). The studio uses it to rebuild in-flight
   * generation tiles after a page reload.
   */
  projectId: string | null;
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

/**
 * Thrown by HTTP clients when the API returns `429 Too Many Requests`.
 *
 * The `Retry-After` header (seconds) is parsed into `retryAfterSeconds`
 * so callers can show a countdown instead of the raw response body.
 * The middleware on our Worker always sets `Retry-After: 60` for the
 * native CF rate-limit binding, but we parse defensively in case a
 * different limiter (or a CDN) emits a different value (or omits it).
 *
 * The `endpoint` field is a coarse label like `'upload.presign'` or
 * `'jobs.submit'` — set by the SDK at the call site so UI can give a
 * domain-appropriate message ("Too many uploads…" vs "Too many job
 * submissions…").
 */
export class RateLimitedError extends Error {
  readonly code = 'rate_limited' as const;
  readonly retryAfterSeconds: number;
  readonly endpoint: string;
  /** HTTP status — always 429 here, kept so callers can `instanceof`-narrow once. */
  readonly status = 429 as const;
  /** Raw server payload, preserved for Sentry / dev tooling. */
  readonly responseBody: string;

  constructor(args: {
    endpoint: string;
    retryAfterSeconds: number;
    responseBody: string;
    message?: string;
  }) {
    super(args.message ?? `${args.endpoint} 429: rate_limited`);
    this.name = 'RateLimitedError';
    this.endpoint = args.endpoint;
    this.retryAfterSeconds = args.retryAfterSeconds;
    this.responseBody = args.responseBody;
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
  | { kind: 'audio'; r2Key: string; mimeType: string; sizeBytes: number }
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
  /** Web-studio project to file the outputs into (omitted on mobile). */
  projectId?: string;
}

export interface JobSubmissionResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  /** Remaining credits AFTER this submission's debit. */
  creditsRemaining: number;
  /** True when the server returned the original job for an idempotent retry. */
  idempotent?: boolean;
}

// ─── Create-flow (prompt-first) ──────────────────────────────────────

/** How the create screen renders image attachments for a model. */
export type CreateAttachmentMode = 'references' | 'frames' | 'seedance';

/**
 * A create-eligible model, as returned by `GET /v1/models`. Everything
 * the model-adaptive create screen needs to reconfigure itself.
 */
export interface GenModel {
  modelKey: string;
  provider: string;
  /** Commercial name shown in the picker. */
  name: string;
  kind: 'image' | 'video';
  /** Flat credit cost per generation. */
  costCredits: number;
  /** Max prompt length in characters for this model. */
  maxPromptChars: number;
  aspectRatios: string[];
  /** Video durations in seconds; empty for image models. */
  durations: number[];
  /**
   * Kling O1: the collapsed duration list that applies while the
   * composer holds a start frame and nothing else — filter the picker
   * to it in that state.
   */
  bareStartFrameDurations?: number[];
  /**
   * The clip length `costCredits` is quoted at. Video models bill per
   * second, so the composer scales the displayed price by
   * `chosen / defaultDuration` — see `resolveCreditCost`.
   */
  defaultDuration?: number;
  /** Total input-image budget. */
  maxImages: number;
  attachments: CreateAttachmentMode;
  /** Image-to-video only — a start frame is mandatory. */
  requiresStartFrame: boolean;
  /** Whether an end/last frame slot is offered. */
  supportsEndFrame: boolean;
  /** Native-audio toggle available (Kling 3 Omni). */
  supportsSound: boolean;
  /**
   * Minimum tier at which native audio actually plays (Kling 2.6:
   * 1080p only). Below it the server drops the audio rather than
   * upgrading the billed tier — the composer gates the toggle.
   */
  soundRequiresTier?: string;
  /**
   * Selectable quality tiers with per-tier prices — Kling resolution
   * (std=720p / pro=1080p / 4k), Gemini output resolution, OpenAI
   * render quality. Absent = fixed quality at `costCredits`.
   * `soundCostCredits` is the tier's price with native audio ON, where
   * the provider bills audio higher (Kling); absent = same as silent.
   * `videoInCostCredits` is the tier's price when the request carries an
   * input/reference video (Kling's 1.5x video-input rate); absent = no
   * rate change for video input at this tier.
   */
  tiers?: {
    mode: string;
    label: string;
    costCredits: number;
    soundCostCredits?: number;
    videoInCostCredits?: number;
  }[];
  /** Pre-selected tier (what `costCredits` reflects). */
  defaultTier?: string;
  /**
   * The provider ignores an explicit aspect ratio once a start frame is
   * attached — the composer disables the ratio picker in that state.
   */
  aspectLockedByStartFrame?: boolean;
  /**
   * Seedance: extra effective output-seconds billed per second of input
   * video — feed to `resolveCreditCost.inputVideoFactor` so the price
   * preview matches the server's charge.
   */
  inputVideoFactor?: number;
  /**
   * Reference VIDEO clips the model accepts (Seedance); absent = none.
   * Drives the composer's attachment policy and client-side clip checks.
   */
  referenceVideo?: {
    max: number;
    maxTotalSeconds: number;
    minClipSeconds: number;
    maxClipSeconds: number;
  };
  /** Reference AUDIO clips (Seedance); absent = none accepted. */
  referenceAudio?: {
    max: number;
    maxTotalSeconds: number;
    minClipSeconds: number;
    maxClipSeconds: number;
  };
  /** Seedance 2.0 family: audio refs need an image/video alongside. */
  audioRefRequiresVisual?: boolean;
  /**
   * Seedance 2.5: the model takes `task: 'edit' | 'extend'` requests —
   * the composer offers its Edit/Extend modes only when this is true.
   */
  supportsVideoTasks?: boolean;
  /**
   * Kling 3 Omni / O1: reference images are accepted alongside or instead
   * of frames — the composer offers a Frames ⇄ References switch.
   */
  supportsReferenceMode?: boolean;
  /** Reference-image budget; 0 = frames only. */
  maxReferences: number;
  /** Kling 3.0 family multi-shot storyboard limits; absent = unsupported. */
  multiShot?: { maxShots: number; maxCharsPerShot: number; minShotSeconds: number; toggleable: boolean };
  /** Image formats the provider accepts, when narrower than our uploads. */
  acceptedImageMimes?: string[];
  /** Provider pixel constraints on input images. */
  imageConstraints?: { minEdge: number; minAspect: number; maxAspect: number };
}

// ─── Notifications (in-app inbox) ────────────────────────────────────

export interface AppNotification {
  id: string;
  type: 'job_completed' | 'job_failed' | 'system';
  title: string;
  body: string;
  /** Deep-link payload (e.g. `{ jobId }`), mirrors the push data. */
  data?: Record<string, unknown>;
  read: boolean;
  /** ISO timestamp. */
  createdAt: string;
  /** Friendly relative time ("2 min ago") — computed by the SDK. */
  whenLabel: string;
}

export interface NotificationList {
  items: AppNotification[];
  unreadCount: number;
}

/** Input for a prompt-first generation (`POST /v1/jobs/create`). */
/**
 * Studio tool request (Camera Angle / Storyboard). Tool jobs carry no
 * model and no engineered prompt — the server owns both; the client
 * sends only these structured parameters (plus the script in `prompt`
 * for storyboard).
 */
export type CreateToolInput =
  | { kind: 'camera_angle'; h: number; v: number }
  | {
      kind: 'storyboard';
      style: 'hand_drawn' | 'sketch' | 'realistic' | 'comic' | '3d';
      cols: number;
      rows: number;
    };

export interface CreateGenerationInput {
  /** Omitted on tool jobs — the server resolves the model itself. */
  modelKey?: string;
  /** Studio tool request; see `CreateToolInput`. */
  tool?: CreateToolInput;
  prompt: string;
  aspectRatio?: string;
  /** Video length in seconds (video models only). */
  duration?: number;
  /** Generate native audio (models with `supportsSound` only). */
  sound?: boolean;
  /**
   * Quality tier (models with `tiers` only). Charged per tier.
   *
   * Deliberately an open string: the key vocabulary belongs to the
   * provider, not to this type. Kling uses std/pro/4k, Gemini uses
   * 512/1K/2K/4K, GPT Image uses low/medium/high. The server validates
   * the key against the model's own tier map and rejects unknown ones,
   * so narrowing here would only break every new provider on arrival.
   */
  quality?: string;
  /**
   * Omni sub-task (Seedance 2.5): `edit` reworks the attached reference
   * video per the prompt (send no duration — output follows the clip);
   * `extend` continues/stitches the attached clip(s).
   */
  task?: 'edit' | 'extend';
  startFrame?: Extract<JobInputValue, { kind: 'image' }>;
  endFrame?: Extract<JobInputValue, { kind: 'image' }>;
  /**
   * Reference files: images everywhere; video and audio clips on models
   * that declare `referenceVideo` / `referenceAudio` budgets (Seedance).
   */
  references?: Array<Extract<JobInputValue, { kind: 'image' | 'video' | 'audio' }>>;
  /**
   * Kling 3.0 family multi-shot storyboard: 2–6 shots, each with its own
   * prompt (≤512 chars) and a duration; durations must sum to `duration`.
   */
  shots?: Array<{ seconds: number; text: string }>;
  idempotencyKey?: string;
  /** Web-studio project to file the outputs into (omitted on mobile). */
  projectId?: string;
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
  /**
   * The template this job was generated from. Lets a result screen
   * opened cold (e.g. from a push notification, with no template id in
   * the route params) still offer "Regenerate" / "Tweak inputs".
   * Optional because legacy `/v1/jobs/:id` responses predate the field.
   */
  templateId?: string;
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
  /**
   * Total count of rows matching the request's filters (independent of
   * `cursor` / `limit`). Only populated when the caller opted in via
   * `withCount: true`. Surfaces in the mobile filter sheet's
   * "Show X results" button.
   */
  total?: number;
}

/**
 * Filters accepted by `catalog.listTemplates`. Mirrors the public
 * `GET /v1/catalog/templates` query schema. All fields optional.
 */
export interface CatalogTemplateListOptions {
  /** Title substring match, case-insensitive. Trim before passing. */
  search?: string;
  kind?: 'image' | 'video' | 'image_set' | 'video_image';
  categoryId?: string;
  featured?: boolean;
  /**
   * `default` = curated order (featured first, then sortOrder).
   * `recent`  = newest published first.
   * `popular` = most-used first (stats.runs DESC, falls back to
   *             curated order when usage data is missing).
   */
  sort?: 'default' | 'recent' | 'popular';
  cursor?: string | null;
  /** 1–50, server default = 20. */
  limit?: number;
  /** When true the response carries a `total` count of all matches. */
  withCount?: boolean;
}

export interface ApiClientOptions {
  /** Inject a custom delay simulator (mock client only) */
  delay?: { min: number; max: number };
  /** Inject a random error rate 0–1 (mock client only) */
  errorRate?: number;
}
