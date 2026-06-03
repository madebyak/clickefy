/**
 * Client contract — the interface every SDK implementation (mock + http)
 * must satisfy. Screens depend on this, never on a concrete client.
 */

import type {
  MeResponse,
  MobileHomeBanner,
  UpdateProfileInput,
} from '@clickfy/types';

import type {
  AuthProvider,
  AuthSession,
  CatalogCategory,
  CatalogTemplate,
  CatalogTemplateListOptions,
  GenerationProgress,
  JobSubmission,
  JobSubmissionResponse,
  OtpChallenge,
  Paginated,
  UserProject,
} from '../types';

export interface CatalogClient {
  listCategories(): Promise<CatalogCategory[]>;
  /**
   * Paginated list of published templates. Accepts the full filter
   * surface of `GET /v1/catalog/templates` — used both by:
   *   • home rails (categoryId only), and
   *   • the search screen (search + kind + featured + withCount).
   */
  listTemplates(opts?: CatalogTemplateListOptions): Promise<Paginated<CatalogTemplate>>;
  getTemplate(id: string): Promise<CatalogTemplate>;
  /** Featured rails for home: returns map keyed by section id */
  getHomeSections(opts?: { categoryId?: string }): Promise<Array<{
    key: string;
    title: string;
    subtitle: string;
    layout: 'bento' | 'carousel';
    templates: CatalogTemplate[];
  }>>;
  /**
   * Save / unsave a template. Returns the new persisted state so
   * the caller can reconcile against optimistic UI without a refetch.
   * Auth required.
   */
  setFavorite(templateId: string, favorited: boolean): Promise<{ isFavorited: boolean }>;
  /**
   * Active home-screen banners — schedule + activation already
   * applied server-side, ordered for direct render. The mobile
   * `<HomeBanner />` component narrows on the discriminated `kind`
   * to pick the right renderer (image / image_slider / video).
   */
  listBanners(): Promise<MobileHomeBanner[]>;
}

export interface AuthClient {
  /** Get current session (null if signed out) */
  getSession(): Promise<AuthSession | null>;
  /**
   * Sign in with provider. For `apple` / `google` this opens an OAuth flow
   * in the real impl and resolves to a session immediately in the mock.
   * For `email` we recommend using `requestOtp` + `verifyOtp` instead —
   * this overload remains for back-compat with early UI prototypes and is
   * effectively a one-shot sign-in skipping the OTP round-trip.
   */
  signIn(provider: AuthProvider, opts?: { email?: string }): Promise<AuthSession>;
  /** Sign out */
  signOut(): Promise<void>;

  // ── OTP-backed email flow ──
  /**
   * Issue a one-time code to `email`. Returns a challenge whose
   * `requestId` is required by `verifyOtp` / `resendOtp`.
   *
   * Throws `AuthError('INVALID_EMAIL')` if the address fails basic
   * syntactic validation, or `AuthError('RATE_LIMITED')` if the caller
   * is requesting codes too quickly for the same email.
   */
  requestOtp(args: { email: string }): Promise<OtpChallenge>;
  /**
   * Register a new account and issue a verification code. The supplied
   * `name` is stored against the pending challenge and only persisted to
   * the session when `verifyOtp` succeeds.
   */
  signUp(args: { name: string; email: string }): Promise<OtpChallenge>;
  /**
   * Re-issue a code for an outstanding challenge. The old code is
   * invalidated. Subject to the challenge's `resendCooldownSec`.
   */
  resendOtp(args: { requestId: string }): Promise<OtpChallenge>;
  /**
   * Exchange a `requestId` + `code` for an active session.
   *
   * Throws `AuthError('CODE_INVALID' | 'CODE_EXPIRED' | 'REQUEST_NOT_FOUND')`.
   */
  verifyOtp(args: { requestId: string; code: string }): Promise<AuthSession>;
}

export interface GenerationClient {
  /**
   * Submit a job to the real backend. Validates inputs, debits
   * credits, queues a Trigger.dev run, and returns the new job id
   * plus the user's remaining credit balance.
   *
   * Throws `JobSubmissionError` on validation / payment / auth
   * failure; the caller is expected to render specific copy per
   * `error.code`.
   *
   * Idempotency: pass `submission.idempotencyKey` (a UUID) and
   * duplicate submits return the same job-id without a second debit.
   */
  submit(submission: JobSubmission): Promise<JobSubmissionResponse>;

  /** Subscribe to job progress. Returns an unsubscribe function. */
  subscribe(jobId: string, onUpdate: (progress: GenerationProgress) => void): () => void;

  /**
   * One-shot fetch of a single job's current state — same data the
   * subscription emits, without starting a polling loop.
   *
   * Primary use: the result screen when it's opened cold (e.g. tapped
   * from a push notification after the app was killed). In that case
   * the in-memory output cache is empty, so the screen fetches the
   * finished job's outputs directly. Also lets the screen react to a
   * still-`processing` or `failed` job rather than rendering an empty
   * result.
   *
   * Auth required. Throws `RateLimitedError` on 429; throws a generic
   * `Error` for other non-2xx responses (including a 404 for an
   * unknown / not-owned job id).
   */
  getJob(jobId: string): Promise<GenerationProgress>;
}

/**
 * Result of a successful user-asset upload. The `key` is what the
 * mobile app stores in form state and later submits with a job —
 * the worker validates ownership via the `user-uploads/<userId>/`
 * prefix. `url` is provided as a convenience for previewing the
 * asset post-upload (e.g. once a network round-trip back is cheaper
 * than re-rendering the local file URI).
 */
export interface UploadedAssetRef {
  key: string;
  url: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Source the mobile app passes when uploading a user asset. We don't
 * type it as a `File` because React Native's `FormData` accepts a
 * `{ uri, name, type }` triple that's not assignable to the DOM
 * `File` type. The HTTP implementation translates accordingly.
 */
export interface UploadSource {
  /** Local file URI from `ImagePicker` / camera, e.g. `file:///…`. */
  uri: string;
  /** Original filename suggested for the upload. */
  name: string;
  /** Mime type. Lowercase, e.g. `image/jpeg`. */
  type: string;
  /**
   * File size in bytes. When provided the SDK uses the presigned-PUT
   * upload path (faster, doesn't stream through the Worker). When
   * omitted it falls back to the multipart `POST /v1/uploads/user`
   * route, which works for any caller but is slower on cellular and
   * burns Worker CPU on the upload body.
   *
   * The mobile picker can populate this from `ImagePicker.assets[i]
   * .fileSize` directly, or by calling
   * `FileSystem.getInfoAsync(uri).size` after a compression step.
   */
  sizeBytes?: number;
}

/**
 * Optional knobs for an upload. `onProgress` is the primary reason
 * this exists — passing a callback switches the HTTP client to an
 * XHR-backed implementation that emits real-time progress events
 * (`fetch` in React Native has no upload progress hook). Omitting
 * the callback keeps the simpler `fetch` code path.
 */
export interface UploadOptions {
  /**
   * Called repeatedly during the upload with `[0..1]` progress.
   * 0 fires immediately after the request opens, 1 once the body
   * has been fully transmitted (note: this is "uploaded", not
   * "accepted by server" — the server's response can still 4xx).
   */
  onProgress?: (fraction: number) => void;
}

export interface UploadsClient {
  /**
   * Stream a user-picked file to R2 via the Worker. The mobile app
   * shows a local preview from `source.uri` while the upload runs;
   * the returned `key` is what flows into the job-submission request.
   *
   * Throws on auth failure, size cap, or unsupported MIME type — the
   * caller is expected to surface a user-friendly toast.
   */
  uploadUserAsset(source: UploadSource, opts?: UploadOptions): Promise<UploadedAssetRef>;
}

/**
 * Current-user / account data. Distinct from the standalone
 * `AuthClient` above: that one models a hypothetical non-Clerk auth
 * provider and is not surfaced on the live client. This namespace is
 * the user's *application* data (profile, plan, credits, preferences)
 * — things only an authenticated, provisioned Clerk user can read.
 *
 * Backed by `/v1/users/me` (+ `/me/avatar`). Centralised here so
 * every caller attaches the Clerk token, parses rate limits, and maps
 * errors the same way — instead of hand-rolling `fetch` per screen.
 */
export interface UserClient {
  /** Canonical "who am I + plan + preferences". `GET /v1/users/me`. */
  getMe(): Promise<MeResponse>;
  /** Update name / locale / preferences. `PATCH /v1/users/me`. */
  updateProfile(input: UpdateProfileInput): Promise<MeResponse>;
  /**
   * Upload (or replace) the profile photo. Multipart `POST
   * /v1/users/me/avatar`. Returns the refreshed `MeResponse` with the
   * new `avatarUrl` already applied.
   */
  uploadAvatar(file: UploadSource): Promise<MeResponse>;
  /**
   * Permanently delete the current account (App Store 5.1.1(v) /
   * Google Play). `DELETE /v1/users/me`. Resolves on success; the
   * caller is responsible for the Clerk `signOut()` + cache clear.
   */
  deleteAccount(): Promise<void>;
}

export interface LibraryClient {
  /**
   * Paginated list of the user's past generations (newest first).
   *
   * Backed by `GET /v1/jobs`. Items embed enough template info that
   * the caller can render them without a second round-trip.
   */
  listProjects(opts?: { limit?: number; cursor?: string | null }): Promise<{
    items: UserProject[];
    nextCursor: string | null;
  }>;

  /**
   * The user's recently-used templates, deduped by template id.
   * Powers the "Recent" view of the Library tab.
   */
  listRecentTemplates(opts?: { limit?: number }): Promise<UserProject[]>;

  /**
   * The user's saved (favorited) templates, newest-save first.
   * Backed by `GET /v1/library/saved`. Each row is a full mobile
   * template DTO with `isFavorited: true` baked in.
   */
  listSavedTemplates(opts?: { limit?: number }): Promise<CatalogTemplate[]>;

  /**
   * Remove a project (job) from the user's history. Idempotent.
   * Backed by `DELETE /v1/jobs/:id`.
   */
  deleteProject(jobId: string): Promise<void>;
}

/**
 * The composed SDK client used by the mobile app.
 *
 * `auth` is intentionally not part of this contract — authentication
 * is owned by Clerk (its React hooks read tokens, manage sign-in
 * state, OAuth flows, etc.). The SDK only attaches tokens to outgoing
 * fetches; everything else about identity lives outside it.
 *
 * The standalone `AuthClient` interface above is kept for now in
 * case a non-Clerk integration ever needs it, but it's not surfaced
 * on the live client.
 */
export interface SDKClient {
  catalog: CatalogClient;
  generation: GenerationClient;
  library: LibraryClient;
  uploads: UploadsClient;
  user: UserClient;
}
