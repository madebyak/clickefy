/**
 * HTTP SDK client — talks to the Worker API at `baseUrl`.
 *
 * Catalog reads are now wired against the public endpoints
 * (`/v1/catalog/templates`, `/v1/catalog/sections`,
 * `/v1/catalog/templates/:id`). Generation, auth, and library remain
 * stubbed and throw a clear "not implemented yet" error so it's
 * obvious which surfaces still depend on the mock during Phase A.
 *
 * Auth posture: methods that require a session use `getToken()` to
 * fetch a fresh Clerk JWT and pass it as `Authorization: Bearer …`.
 * Catalog reads are public — no token is sent so the home screen
 * works pre-sign-in.
 */

import type {
  MeResponse,
  MobileHomeBanner,
  MobileTemplate,
  UpdateProfileInput,
} from '@clickfy/types';

import type {
  AppNotification,
  CatalogCategory,
  CatalogTemplate,
  GenerationProgress,
  GenModel,
  JobSubmission,
  JobSubmissionResponse,
  NotificationList,
  TemplateKind as SdkTemplateKind,
  UserProject,
} from '../types';
import { JobSubmissionError, RateLimitedError } from '../types';
import type {
  CreditsSummary,
  AssetDetail,
  FavoriteAssetsResponse,
  ProjectAssetsResponse,
  MediaAsset,
  MediaFolder,
  MediaLibraryResponse,
  MediaUsage,
  ProjectsListResponse,
  SDKClient,
  StoreCatalog,
  StudioFolder,
  StudioProject,
  UploadSource,
  UploadedAssetRef,
} from './contract';

// ── /v1/jobs/:id response shape ─────────────────────────────────────
// Mirrors apps/api/src/routes/jobs.ts. Kept in this file rather than
// hoisted to `../types` because the Worker's wire format is an
// internal contract — callers consume the `GenerationProgress`
// adapter, not the raw response.
interface JobProgressWire {
  stage: number;
  totalStages: number;
  message: string;
}
interface JobErrorWire {
  code: string;
  message: string;
}
interface JobStatusWire {
  jobId: string;
  /** Template the job was generated from. Optional for legacy rows. */
  templateId?: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: JobProgressWire | null;
  /**
   * New wire format: each output carries its media kind and (when the
   * worker knows them) native pixel dimensions + aspect ratio.
   */
  outputs?: Array<{
    url: string;
    kind: 'image' | 'video';
    width?: number;
    height?: number;
    aspectRatio?: number;
  }>;
  error?: JobErrorWire;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * Throw a typed `RateLimitedError` when a response is 429. No-op
 * otherwise — caller falls through to its usual error handling for
 * other statuses. Kept tiny on purpose: every authed mutating endpoint
 * can use this in one line instead of duplicating header parsing.
 *
 * The Worker's `withRateLimit` middleware always sets
 * `Retry-After: 60`; we still parse defensively in case a CDN or a
 * future limiter chooses a different value (or omits the header). A
 * sensible floor of 1s keeps countdowns sane when the header is
 * missing or junk.
 */
async function throwIfRateLimited(res: Response, endpoint: string): Promise<void> {
  if (res.status !== 429) return;
  const body = await res.text().catch(() => '');
  const headerRaw = res.headers.get('retry-after');
  const parsed = headerRaw ? Number(headerRaw) : NaN;
  const retryAfterSeconds =
    Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 60;
  throw new RateLimitedError({
    endpoint,
    retryAfterSeconds,
    responseBody: body,
  });
}

/**
 * Format an ISO timestamp into a human-friendly "2 min ago" style.
 * Lives here (not in `formatters/`) because the projects list is the
 * only consumer today; promote when a second caller appears.
 *
 * Intentionally cheap — no date library. Buckets:
 *   <60s        → "just now"
 *   <60m        → "N min ago"
 *   <24h        → "N h ago"
 *   <7d         → "N days ago"
 *   otherwise   → locale date
 */
function formatWhenLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(iso).toLocaleDateString();
}

function statusFallbackLabel(status: JobStatusWire['status']): string {
  // Used while progress is still null (job freshly queued, dispatcher
  // hasn't moved it yet). The Worker emits a real label as soon as
  // the Trigger.dev task starts running, so this only renders for
  // the first ~1s of a job's life.
  switch (status) {
    case 'queued':
      return 'Waiting in queue…';
    case 'processing':
      return 'Working on it…';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
  }
}

/**
 * Map the Worker's `/v1/jobs/:id` wire shape onto the SDK's
 * `GenerationProgress`. Shared by `generation.subscribe` (polling) and
 * `generation.getJob` (one-shot) so the two never drift apart.
 *
 * Note `stageProgress` is approximated: Trigger.dev doesn't report an
 * intra-stage percentage, so the UI relies on `stageIndex`/`stageCount`
 * and we just emit 0 / 0.5 / 1 to bucket queued / running / done.
 */
function mapJobStatusToProgress(data: JobStatusWire): GenerationProgress {
  return {
    jobId: data.jobId,
    templateId: data.templateId,
    status: data.status,
    stageProgress:
      data.status === 'completed' ? 1 : data.status === 'queued' ? 0 : 0.5,
    stageIndex: data.progress?.stage ?? 0,
    stageCount: data.progress?.totalStages ?? 0,
    stageLabel: data.progress?.message ?? statusFallbackLabel(data.status),
    outputs: data.outputs,
    error: data.error?.message,
  };
}

export interface HttpClientOptions {
  baseUrl: string;
  /** Bearer token getter (returns null if signed out). */
  getToken?: () => Promise<string | null>;
  /**
   * Active UI locale getter (e.g. `'ar'`). When it returns a non-English
   * locale, catalog reads append `?locale=<loc>` so the API resolves
   * translated content (English remains the per-field fallback). Read on
   * every call so a language change is picked up without re-creating the
   * client.
   */
  getLocale?: () => string;
}

// ─── Wire shapes ──────────────────────────────────────────────────

interface ApiCategoryRow {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  parentId: string | null;
  sortOrder: number;
  /**
   * Direct sub-categories, attached server-side by GET /v1/categories.
   * Optional because the field landed after sub-categories shipped —
   * older API deployments won't include it.
   */
  children?: ApiCategoryRow[];
}

interface ApiEnvelope<T> {
  data: T;
  error?: { code: string; message: string };
}

interface ApiSectionsEnvelope {
  sections: Array<{
    key: string;
    title: string;
    subtitle: string;
    layout: 'bento' | 'carousel';
    templates: MobileTemplate[];
  }>;
}

interface ApiTemplatesEnvelope {
  data: MobileTemplate[];
  nextCursor: string | null;
  /**
   * Optional total count, returned only when the request opted-in via
   * `withCount=true`. Forwarded to callers as `Paginated.total`.
   */
  meta?: { total?: number };
}

// ─── Mappers ──────────────────────────────────────────────────────

const SLUG_COLORS: Record<string, string> = {
  skincare: '#FF8FA3',
  fashion: '#7C3AED',
  'food-drink': '#F59E0B',
  tech: '#3B82F6',
  'home-living': '#10B981',
  fitness: '#EF4444',
  jewelry: '#A78BFA',
  pets: '#F97316',
};

function colourForSlug(slug: string): string {
  return SLUG_COLORS[slug] ?? '#7C3AED';
}

function mapCategory(row: ApiCategoryRow): CatalogCategory {
  return {
    id: row.id,
    label: row.name,
    imageUri: row.iconUrl,
    color: colourForSlug(row.slug),
    parentId: row.parentId,
    // Recurse so each child also gets the SDK projection. Depth is
    // bounded at 2 by the API guard, so this never spirals.
    children: row.children ? row.children.map(mapCategory) : undefined,
  };
}

/**
 * Compute a CSS-style aspect string ("4/5", "16/9", …) from a
 * `MobileImageRef`. The mobile components consume this to lay out
 * cards before the image has finished loading.
 *
 * Falls back to "4/5" (matching the legacy mock default) if the
 * dimensions are missing — extremely defensive, shouldn't happen
 * in practice because admin uploads always measure dimensions.
 */
function aspectFromDimensions(width: number, height: number): string {
  if (!width || !height) return '4/5';
  return `${width}/${height}`;
}

/**
 * Map the Worker's `MobileTemplate` projection onto the older
 * `CatalogTemplate` shape the mobile components consume. The two
 * differ in:
 *
 *   - `coverImage` is flattened to a URL string (CatalogTemplate)
 *     vs. `{ url, width, height, blurhash }` (MobileTemplate).
 *   - `previewVideo` flattens to the HLS manifest URL string.
 *   - `kind: 'image_set'` → `'set'` (legacy short form).
 *   - `costCredits` → `credits`.
 *   - `aspect` is derived from cover dimensions.
 *
 * We could replace `CatalogTemplate` with `MobileTemplate` outright
 * and refactor every screen — that's Phase D cleanup work. For now,
 * mapping at the boundary keeps the surface area of this change
 * tightly scoped to one file.
 */
function mapTemplate(m: MobileTemplate & { isFavorited?: boolean }): CatalogTemplate {
  // `kindExact` carries the true kind (incl. `video_image`); the legacy
  // `kind` field is down-mapped server-side for old installed builds.
  const rawKind = m.kindExact ?? m.kind;
  const sdkKind: SdkTemplateKind =
    rawKind === 'image_set' ? 'set' : (rawKind as SdkTemplateKind);
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    categoryId: m.categoryId,
    categoryIds: m.categoryIds ?? [m.categoryId],
    kind: sdkKind,
    coverImage: m.coverImage.url,
    previewVideo: m.previewVideo?.hlsUrl,
    gallery: m.gallery.length > 0 ? m.gallery.map((g) => g.url) : undefined,
    aspect: aspectFromDimensions(m.coverImage.width, m.coverImage.height),
    credits: m.costCredits,
    featured: m.featured,
    userInputs: m.userInputs?.length ? m.userInputs : undefined,
    userCanChooseAspectRatio: m.userCanChooseAspectRatio,
    outputs: m.outputs,
    isFavorited: m.isFavorited,
  };
}

// ─── Client factory ───────────────────────────────────────────────

export function createHttpClient(options: HttpClientOptions): SDKClient {
  const { baseUrl, getToken, getLocale } = options;

  /**
   * Append `?locale=<loc>` to a catalog path when the active locale is a
   * non-English language. English is the canonical content, so we leave
   * those requests untouched (identical URL + edge-cache entry as before).
   * Merges cleanly with any existing query string.
   */
  function withLocale(path: string): string {
    const loc = getLocale?.();
    if (!loc || loc === 'en') return path;
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}locale=${encodeURIComponent(loc)}`;
  }

  async function get<T>(path: string, init?: { auth?: boolean }): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init?.auth && getToken) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${baseUrl}${path}`, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET ${path} ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  // Authed mutation with a JSON body. Returns the parsed envelope `data`
  // (or undefined for 204s). Used by the projects/folders CRUD surface.
  async function mutateJson<T>(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (getToken) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    await throwIfRateLimited(res, `${method} ${path}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json()) as { data: T };
    return json.data;
  }

  // Bodyless authed mutation (POST/DELETE with no request body). Used by
  // simple state toggles like the notification read/clear endpoints.
  async function mutate(method: 'POST' | 'DELETE', path: string): Promise<void> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (getToken) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${baseUrl}${path}`, { method, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${method} ${path} ${res.status}: ${body.slice(0, 200)}`);
    }
  }

  return {
    catalog: {
      async listCategories(): Promise<CatalogCategory[]> {
        const json = await get<ApiEnvelope<ApiCategoryRow[]>>(
          withLocale('/v1/categories'),
        );
        return json.data.map(mapCategory);
      },

      async listTemplates(opts) {
        // Full filter surface, matching `GET /v1/catalog/templates`.
        // Empty / blank `search` is dropped on the wire so the server
        // doesn't run the rank CASE for nothing.
        const params = new URLSearchParams();
        const search = opts?.search?.trim();
        if (search) params.set('search', search);
        if (opts?.kind) params.set('kind', opts.kind);
        if (opts?.categoryId) params.set('categoryId', opts.categoryId);
        if (opts?.featured !== undefined) {
          params.set('featured', String(opts.featured));
        }
        if (opts?.sort) params.set('sort', opts.sort);
        if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
        if (opts?.withCount) params.set('withCount', 'true');
        if (opts?.cursor) params.set('cursor', opts.cursor);
        const qs = params.toString();
        const json = await get<ApiTemplatesEnvelope>(
          withLocale(`/v1/catalog/templates${qs ? `?${qs}` : ''}`),
        );
        return {
          data: json.data.map(mapTemplate),
          nextCursor: json.nextCursor,
          ...(json.meta?.total !== undefined ? { total: json.meta.total } : {}),
        };
      },

      async getTemplate(id: string): Promise<CatalogTemplate> {
        // `auth: true` so the Worker can resolve `isFavorited`. The
        // endpoint still works unauthenticated (returns the template
        // without favorite state); attaching the token when we have
        // one means the result page heart can render correctly on
        // first paint.
        const json = await get<ApiEnvelope<MobileTemplate & { isFavorited?: boolean }>>(
          withLocale(`/v1/catalog/templates/${id}`),
          { auth: true },
        );
        return mapTemplate(json.data);
      },

      // ─── Favorites ────────────────────────────────────────────────
      //
      // POST/DELETE `/v1/catalog/templates/:id/favorite`. We attach
      // the auth header eagerly — the endpoints are user-scoped.
      // Returns the post-mutation state so optimistic UIs can
      // confirm or roll back without a refetch.
      async setFavorite(templateId: string, favorited: boolean) {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const url = `${baseUrl}/v1/catalog/templates/${templateId}/favorite`;
        const res = await fetch(url, {
          method: favorited ? 'POST' : 'DELETE',
          headers,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(
            `setFavorite(${templateId}, ${favorited}) failed (${res.status}): ${body.slice(0, 200)}`,
          );
        }
        const json = (await res.json()) as {
          data: { templateId: string; isFavorited: boolean };
        };
        return { isFavorited: json.data.isFavorited };
      },

      async getHomeSections(opts?: { categoryId?: string }) {
        // Single composite request. Rails arrive pre-pruned (empty
        // sections never reach the client). Edge-cached by the
        // Worker for 60s, so steady-state opens hit a Cloudflare PoP
        // in ~10ms.
        //
        // Optional `categoryId` powers the category chips on the home
        // screen — same endpoint, scoped response. Cache cardinality
        // is bounded by `1 + categoryCount` keys at the edge.
        const params = new URLSearchParams();
        if (opts?.categoryId && opts.categoryId !== 'all') {
          params.set('categoryId', opts.categoryId);
        }
        const qs = params.toString();
        const json = await get<ApiSectionsEnvelope>(
          withLocale(`/v1/catalog/sections${qs ? `?${qs}` : ''}`),
        );
        return json.sections.map((s) => ({
          key: s.key,
          title: s.title,
          subtitle: s.subtitle,
          layout: s.layout,
          templates: s.templates.map(mapTemplate),
        }));
      },

      async listBanners() {
        // Public endpoint — no auth header required. Server already
        // filtered by `is_active` + schedule window, so the mobile
        // renderer can iterate the response directly without
        // re-checking timestamps.
        const json = await get<ApiEnvelope<MobileHomeBanner[]>>(
          withLocale('/v1/catalog/banners'),
        );
        return json.data;
      },
    },

    generation: {
      // Real submission against `POST /v1/jobs` (Phase B2). Validates
      // inputs, debits credits, and returns the queued job-id plus the
      // user's remaining balance. The Trigger.dev dispatcher (B3) picks
      // up the queued row asynchronously; B4 adds the polling endpoint
      // that drives the "Generating…" screen.
      async submit(submission: JobSubmission): Promise<JobSubmissionResponse> {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        if (submission.idempotencyKey) {
          headers['Idempotency-Key'] = submission.idempotencyKey;
        }

        let res: Response;
        try {
          res = await fetch(`${baseUrl}/v1/jobs`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              templateId: submission.templateId,
              inputs: submission.inputs,
              options: submission.options ?? {},
              projectId: submission.projectId,
            }),
          });
        } catch (err) {
          throw new JobSubmissionError(
            'network_error',
            err instanceof Error ? err.message : 'Network error',
          );
        }

        if (!res.ok) {
          // Parse the Worker's error envelope. We accept both the
          // wrapped form `{ error: { code, message, ... } }` (B2 shape)
          // and Hono's zod-validator default error so the SDK keeps
          // working if a route ever bypasses the wrapper.
          let parsed: unknown = null;
          try {
            parsed = await res.json();
          } catch {
            /* ignore — fall through to a generic error below */
          }
          const errObj = (parsed as { error?: unknown })?.error;
          if (errObj && typeof errObj === 'object') {
            const e = errObj as {
              code?: string;
              message?: string;
              fieldKey?: string;
              details?: Record<string, unknown>;
            };
            throw new JobSubmissionError(
              (e.code as JobSubmissionError['code']) ?? 'network_error',
              e.message ?? `Request failed (${res.status})`,
              { fieldKey: e.fieldKey, details: e.details, httpStatus: res.status },
            );
          }
          throw new JobSubmissionError(
            'network_error',
            `POST /v1/jobs ${res.status}`,
            { httpStatus: res.status },
          );
        }

        const json = (await res.json()) as {
          data: JobSubmissionResponse;
        };
        return json.data;
      },

      // Prompt-first "create from scratch" — POST /v1/jobs/create.
      // Same envelope + error handling as `submit`, but the body carries
      // the model + prompt + optional attachments instead of a template.
      async createGenerate(input): Promise<JobSubmissionResponse> {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        if (input.idempotencyKey) {
          headers['Idempotency-Key'] = input.idempotencyKey;
        }

        let res: Response;
        try {
          res = await fetch(`${baseUrl}/v1/jobs/create`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              modelKey: input.modelKey,
              prompt: input.prompt,
              aspectRatio: input.aspectRatio,
              duration: input.duration,
              sound: input.sound,
              quality: input.quality,
              startFrame: input.startFrame,
              endFrame: input.endFrame,
              references: input.references ?? [],
              projectId: input.projectId,
            }),
          });
        } catch (err) {
          throw new JobSubmissionError(
            'network_error',
            err instanceof Error ? err.message : 'Network error',
          );
        }

        if (!res.ok) {
          let parsed: unknown = null;
          try {
            parsed = await res.json();
          } catch {
            /* ignore — fall through to a generic error below */
          }
          const errObj = (parsed as { error?: unknown })?.error;
          if (errObj && typeof errObj === 'object') {
            const e = errObj as {
              code?: string;
              message?: string;
              fieldKey?: string;
              details?: Record<string, unknown>;
            };
            throw new JobSubmissionError(
              (e.code as JobSubmissionError['code']) ?? 'network_error',
              e.message ?? `Request failed (${res.status})`,
              { fieldKey: e.fieldKey, details: e.details, httpStatus: res.status },
            );
          }
          throw new JobSubmissionError('network_error', `POST /v1/jobs/create ${res.status}`, {
            httpStatus: res.status,
          });
        }

        const json = (await res.json()) as { data: JobSubmissionResponse };
        return json.data;
      },

      // Real progress streaming (B4). We poll `GET /v1/jobs/:id`
      // because Cloudflare Workers can't keep WebSockets open
      // cheaply across the free-tier CPU limit, and Server-Sent
      // Events add complexity that's only worth it once we have
      // tens of thousands of in-flight jobs. At ~1s polling, the
      // worker handles each request in < 10ms (one indexed DB
      // read), so the cost ceiling is comfortably high.
      //
      // Returns an unsubscribe function the caller invokes on
      // screen-unmount. We use that to cancel the next scheduled
      // tick — important on React Native where leaked timers
      // survive navigation and waste battery.
      subscribe(jobId, onUpdate) {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        // Track the previous status so we only push updates when
        // something interesting changed (status / stage / outputs).
        // Without this guard, a "queued" job would trigger a
        // re-render every second with identical data.
        let lastSerialized = '';

        const tick = async () => {
          if (cancelled) return;
          try {
            const headers: Record<string, string> = { Accept: 'application/json' };
            if (getToken) {
              const token = await getToken();
              if (token) headers.Authorization = `Bearer ${token}`;
            }
            const res = await fetch(`${baseUrl}/v1/jobs/${jobId}`, { headers });
            if (cancelled) return;

            if (!res.ok) {
              // 404 right after submit can happen (rare; Neon read
              // replica lag). Treat any non-2xx as transient and try
              // again on the next tick rather than tearing the
              // subscription down — the UI shows the spinner either
              // way and most failures clear within 1–2 polls.
              schedule(2_000);
              return;
            }

            const json = (await res.json()) as {
              data: JobStatusWire;
            };
            const data = json.data;

            // The Worker emits `{ stage, totalStages, message }` — we
            // map to the SDK's `GenerationProgress` shape so mobile
            // screens don't need to know the wire format. Shared with
            // `getJob` via `mapJobStatusToProgress`.
            const progress: GenerationProgress = mapJobStatusToProgress(data);

            const serialized = JSON.stringify(progress);
            if (serialized !== lastSerialized) {
              lastSerialized = serialized;
              onUpdate(progress);
            }

            if (data.status === 'completed' || data.status === 'failed') {
              // Terminal — stop polling. The caller will likely call
              // unsubscribe shortly after seeing this update, but
              // we don't want to bank on it.
              cancelled = true;
              return;
            }
            schedule(1_000);
          } catch {
            if (cancelled) return;
            // Network blip — back off and try again. We deliberately
            // don't surface the error to `onUpdate`; the UI can't act
            // on a transient `fetch` failure and showing one would
            // flicker between "Generating" and "Failed".
            schedule(2_000);
          }
        };

        const schedule = (ms: number) => {
          if (cancelled) return;
          timer = setTimeout(tick, ms);
        };

        // Kick off immediately so the screen has data on first paint
        // rather than a 1s blank.
        void tick();

        return () => {
          cancelled = true;
          if (timer) clearTimeout(timer);
        };
      },

      // One-shot read of `GET /v1/jobs/:id`. Same endpoint the
      // subscription polls, but resolves once instead of looping — the
      // result screen uses it to recover outputs when it's opened cold
      // (push-notification deep link, app was killed) and the in-memory
      // output cache is therefore empty.
      async getJob(jobId: string): Promise<GenerationProgress> {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(`${baseUrl}/v1/jobs/${jobId}`, { headers });
        await throwIfRateLimited(res, 'jobs.get');
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`GET /v1/jobs/${jobId} failed (${res.status}): ${text.slice(0, 200)}`);
        }
        const json = (await res.json()) as { data: JobStatusWire };
        return mapJobStatusToProgress(json.data);
      },
    },
    library: {
      // ─── Projects tab ───────────────────────────────────────────────
      //
      // Paginates `GET /v1/jobs`. We attach the auth header eagerly —
      // the endpoint is user-scoped, so a missing token always fails.
      // The Worker already embeds the template summary + materialised
      // output URLs, so the response maps straight onto `UserProject[]`.
      // `whenLabel` is formatted client-side from `createdAt` so it
      // stays fresh without refetching.
      async listProjects(opts: { limit?: number; cursor?: string | null } = {}) {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const params = new URLSearchParams();
        if (opts.limit) params.set('limit', String(opts.limit));
        if (opts.cursor) params.set('cursor', opts.cursor);
        const qs = params.toString();
        const url = `${baseUrl}/v1/jobs${qs ? `?${qs}` : ''}`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`library.listProjects failed (${res.status}): ${text.slice(0, 200)}`);
        }
        const json = (await res.json()) as {
          data: { items: UserProject[]; nextCursor: string | null };
        };
        const items = json.data.items.map((p) => ({
          ...p,
          whenLabel: formatWhenLabel(p.createdAt),
        }));
        return { items, nextCursor: json.data.nextCursor };
      },

      // ─── Library tab ────────────────────────────────────────────────
      //
      // "Recent templates": pull a wider window of jobs and dedupe by
      // `templateId`, keeping the first (newest) occurrence. We over-
      // fetch (limit * 4) so a user who used the same template many
      // times in a row still sees variety. If they have a deeper
      // history we'd need server-side `DISTINCT ON`, but that's not
      // worth the complexity until users complain.
      async listRecentTemplates(opts: { limit?: number } = {}) {
        const limit = opts.limit ?? 20;
        const { items } = await this.listProjects({ limit: Math.min(50, limit * 4) });
        const seen = new Set<string>();
        const out: UserProject[] = [];
        for (const p of items) {
          // Skip prompt-first "create" jobs — they have no template, so
          // they don't belong in the "recent templates" rail.
          if (!p.templateId || seen.has(p.templateId)) continue;
          seen.add(p.templateId);
          out.push(p);
          if (out.length >= limit) break;
        }
        return out;
      },

      // ─── Saved templates ────────────────────────────────────────────
      //
      // Backed by `GET /v1/library/saved`. The Worker returns full
      // MobileTemplate DTOs with `isFavorited: true` baked in; we
      // run them through the same `mapTemplate` adapter as the
      // catalog endpoints so consumers get a uniform `CatalogTemplate`.
      async listSavedTemplates(opts: { limit?: number } = {}) {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const params = new URLSearchParams();
        if (opts.limit) params.set('limit', String(opts.limit));
        const qs = params.toString();
        const res = await fetch(`${baseUrl}/v1/library/saved${qs ? `?${qs}` : ''}`, { headers });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`library.listSavedTemplates failed (${res.status}): ${text.slice(0, 200)}`);
        }
        const json = (await res.json()) as {
          data: { items: Array<MobileTemplate & { isFavorited?: boolean }> };
        };
        return json.data.items.map(mapTemplate);
      },

      // ─── Delete project ─────────────────────────────────────────────
      //
      // Backed by `DELETE /v1/jobs/:id`. Idempotent — a 404 is
      // swallowed so the caller's optimistic UI doesn't bounce if
      // the row was already removed.
      async deleteProject(jobId: string) {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(`${baseUrl}/v1/jobs/${jobId}`, {
          method: 'DELETE',
          headers,
        });
        if (!res.ok && res.status !== 404) {
          const text = await res.text().catch(() => '');
          throw new Error(`library.deleteProject failed (${res.status}): ${text.slice(0, 200)}`);
        }
      },
    },

    credits: {
      // `GET /v1/credits/me` — the signed-in user's bucket breakdown
      // (promo / subscription / topup) plus the spendability flag the
      // credit menu needs. Total mirrors `MeResponse.creditsBalance`.
      async getSummary(): Promise<CreditsSummary> {
        const json = await get<ApiEnvelope<CreditsSummary>>('/v1/credits/me', { auth: true });
        return json.data;
      },
    },

    media: {
      // "My Assets" — the user's uploaded source media. Distinct from
      // `library`, which is the mobile Library tab of past GENERATIONS.
      // Everything here is server-scoped to the caller.
      async list() {
        const json = await get<ApiEnvelope<MediaLibraryResponse>>('/v1/media', { auth: true });
        return json.data;
      },
      async usage() {
        const json = await get<ApiEnvelope<MediaUsage>>('/v1/media/usage', { auth: true });
        return json.data;
      },
      async createFolder(input) {
        return mutateJson<MediaFolder>('POST', '/v1/media/folders', input);
      },
      async renameFolder(folderId, name) {
        return mutateJson<{ id: string; name: string }>(
          'PATCH',
          `/v1/media/folders/${folderId}`,
          { name },
        );
      },
      async deleteFolder(folderId) {
        return mutateJson<{ id: string }>('DELETE', `/v1/media/folders/${folderId}`);
      },
      async register(input) {
        return mutateJson<MediaAsset>('POST', '/v1/media/register', input);
      },
      async updateAsset(assetId, input) {
        return mutateJson<{ id: string; name: string; folderId: string | null }>(
          'PATCH',
          `/v1/media/assets/${assetId}`,
          input,
        );
      },
      async deleteAssets(assetIds) {
        // POST rather than DELETE: a bulk delete carries a body, and
        // DELETE-with-body is inconsistently supported across proxies.
        return mutateJson<{ deleted: number }>('POST', '/v1/media/assets/delete', { assetIds });
      },
    },
    projects: {
      // The web studio's persistent projects layer. Thin wrappers over
      // /v1/projects + /v1/folders + /v1/assets; all server-scoped to
      // the caller, so no client-side ownership logic lives here.
      async list(opts) {
        const params = new URLSearchParams();
        if (opts?.limit) params.set('limit', String(opts.limit));
        if (opts?.cursor) params.set('cursor', opts.cursor);
        const qs = params.size > 0 ? `?${params}` : '';
        const json = await get<ApiEnvelope<ProjectsListResponse>>(`/v1/projects${qs}`, {
          auth: true,
        });
        return json.data;
      },
      async create(input) {
        return mutateJson<StudioProject>('POST', '/v1/projects', input ?? {});
      },
      async update(projectId, input) {
        return mutateJson('PATCH', `/v1/projects/${projectId}`, input);
      },
      async delete(projectId) {
        await mutateJson<void>('DELETE', `/v1/projects/${projectId}`);
      },
      async getAsset(projectId, assetId) {
        const json = await get<ApiEnvelope<AssetDetail>>(
          `/v1/projects/${projectId}/assets/${assetId}`,
          { auth: true },
        );
        return json.data;
      },
      async listAssets(projectId, opts) {
        const params = new URLSearchParams();
        if (opts?.limit) params.set('limit', String(opts.limit));
        if (opts?.cursor) params.set('cursor', opts.cursor);
        const qs = params.size > 0 ? `?${params}` : '';
        const json = await get<ApiEnvelope<ProjectAssetsResponse>>(
          `/v1/projects/${projectId}/assets${qs}`,
          { auth: true },
        );
        return json.data;
      },
      async copyAssets(projectId, assetIds) {
        return mutateJson<{ copied: number }>('POST', `/v1/projects/${projectId}/assets`, {
          assetIds,
        });
      },
      async moveAssets(assetIds, projectId) {
        return mutateJson<{ moved: number }>('PATCH', '/v1/assets', { assetIds, projectId });
      },
      async deleteAssets(assetIds) {
        await mutateJson<void>('DELETE', '/v1/assets', { assetIds });
      },
      async listFavorites(opts) {
        const params = new URLSearchParams();
        if (opts?.limit) params.set('limit', String(opts.limit));
        if (opts?.cursor) params.set('cursor', opts.cursor);
        const qs = params.size > 0 ? `?${params}` : '';
        const json = await get<ApiEnvelope<FavoriteAssetsResponse>>(
          `/v1/assets/favorites${qs}`,
          { auth: true },
        );
        return json.data;
      },
      async setAssetsFavorite(assetIds, favorited) {
        await mutateJson<void>(favorited ? 'POST' : 'DELETE', '/v1/assets/favorites', {
          assetIds,
        });
      },
      async createFolder(name) {
        return mutateJson<StudioFolder>('POST', '/v1/folders', { name });
      },
      async renameFolder(folderId, name) {
        return mutateJson('PATCH', `/v1/folders/${folderId}`, { name });
      },
      async deleteFolder(folderId) {
        await mutateJson<void>('DELETE', `/v1/folders/${folderId}`);
      },
    },

    store: {
      // `GET /v1/store` — DB catalog for the paywall + top-up screen
      // (which products exist + how many credits each grants). Prices come
      // from RevenueCat, not here. Auth is optional server-side; we attach
      // the token when present so subscribers also receive top-up packs and
      // `currentEntitlement` is populated.
      async getCatalog(): Promise<StoreCatalog> {
        const json = await get<ApiEnvelope<StoreCatalog>>('/v1/store', { auth: true });
        return json.data;
      },
    },

    models: {
      // `GET /v1/models` — create-eligible model roster (name, cost, prompt
      // cap, aspect ratios, durations, attachment shape) for the create
      // screen. Auth required.
      async listModels(): Promise<GenModel[]> {
        const json = await get<ApiEnvelope<{ models: GenModel[] }>>('/v1/models', {
          auth: true,
        });
        return json.data.models;
      },
    },

    notifications: {
      // `GET /v1/notifications` — the user's inbox (≤30) + unread count.
      // `whenLabel` is formatted client-side so it stays fresh on re-render.
      async list(): Promise<NotificationList> {
        const json = await get<
          ApiEnvelope<{ items: Omit<AppNotification, 'whenLabel'>[]; unreadCount: number }>
        >('/v1/notifications', { auth: true });
        return {
          items: json.data.items.map((n) => ({
            ...n,
            whenLabel: formatWhenLabel(n.createdAt),
          })),
          unreadCount: json.data.unreadCount,
        };
      },
      async markAllRead(): Promise<void> {
        await mutate('POST', '/v1/notifications/read-all');
      },
      async markRead(id: string): Promise<void> {
        await mutate('POST', `/v1/notifications/${id}/read`);
      },
      async clearAll(): Promise<void> {
        await mutate('DELETE', '/v1/notifications');
      },
    },

    uploads: {
      async uploadUserAsset(
        source: UploadSource,
        opts?: { onProgress?: (fraction: number) => void },
      ): Promise<UploadedAssetRef> {
        // Auth required: the Worker derives the user-scoped R2 prefix
        // from the Clerk session, so we must attach a fresh token.
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }

        // ── Presigned PUT path (preferred) ──────────────────────────
        //
        // Triggered when the caller knows the file size upfront — the
        // presign endpoint needs it so it can enforce the size cap
        // BEFORE we hand the client a URL. The flow is:
        //
        //   1. POST /v1/uploads/user/presign  { contentType, sizeBytes }
        //      → { uploadUrl, key, headers }
        //   2. XHR PUT uploadUrl with the file body + signed headers,
        //      reporting progress along the way.
        //   3. POST /v1/uploads/user/finalize { key }
        //      → { key, url, contentType, sizeBytes }
        //
        // We never see the file bytes in the Worker on this path, so
        // big videos no longer eat CPU time or hit the request-body
        // limit. The multipart fallback below stays in place for
        // callers that haven't been updated yet.
        if (typeof source.sizeBytes === 'number' && source.sizeBytes > 0) {
          const presignRes = await fetch(`${baseUrl}/v1/uploads/user/presign`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contentType: source.type,
              sizeBytes: source.sizeBytes,
            }),
          });
          // Surface 429 as a typed error before falling through to the
          // generic message path — UI can show a countdown rather than
          // the raw JSON envelope.
          await throwIfRateLimited(presignRes, 'upload.presign');
          if (!presignRes.ok) {
            const text = await presignRes.text().catch(() => '');
            throw new Error(`upload.presign ${presignRes.status}: ${text.slice(0, 200)}`);
          }
          const presigned = (await presignRes.json()) as {
            data: {
              uploadUrl: string;
              key: string;
              contentType: string;
              expiresAt: string;
              headers: Record<string, string>;
            };
          };

          // PUT the file to R2 directly. XHR is the only way to get
          // upload progress in React Native, so we always use it on
          // this path — the per-call overhead vs. `fetch` is trivial.
          const onProgress = opts?.onProgress;
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', presigned.data.uploadUrl);
            for (const [k, v] of Object.entries(presigned.data.headers)) {
              xhr.setRequestHeader(k, v);
            }
            if (onProgress) {
              xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && event.total > 0) {
                  onProgress(Math.min(1, event.loaded / event.total));
                }
              };
            }
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                onProgress?.(1);
                resolve();
              } else {
                reject(
                  new Error(`upload.put ${xhr.status}: ${xhr.responseText.slice(0, 200)}`),
                );
              }
            };
            xhr.onerror = () => reject(new Error('upload.put: network error'));
            xhr.ontimeout = () => reject(new Error('upload.put: timed out'));
            // Web callers pass a real `Blob`/`File`; React Native passes
            // `{ uri }`, which RN's XHR accepts as a body and streams the
            // file from disk (not assignable to the DOM body type, hence
            // the cast).
            //
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            xhr.send(source.file ?? ({ uri: source.uri } as any));
          });

          const finalizeRes = await fetch(`${baseUrl}/v1/uploads/user/finalize`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: presigned.data.key }),
          });
          await throwIfRateLimited(finalizeRes, 'upload.finalize');
          if (!finalizeRes.ok) {
            const text = await finalizeRes.text().catch(() => '');
            throw new Error(`upload.finalize ${finalizeRes.status}: ${text.slice(0, 200)}`);
          }
          const finalized = (await finalizeRes.json()) as { data: UploadedAssetRef };
          return finalized.data;
        }

        // ── Multipart fallback (no size known) ──────────────────────
        const body = new FormData();
        if (source.file) {
          // Web: a real Blob/File appends natively.
          body.append('file', source.file, source.name);
        } else {
          // React Native's `FormData` accepts the `{ uri, name, type }`
          // triple — the bridge converts it into a multipart part with
          // the file streamed off-disk. Casting through `any` because
          // the DOM TS types don't model this RN-specific form.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (body as any).append('file', {
            uri: source.uri,
            name: source.name,
            type: source.type,
          } as unknown as Blob);
        }

        const url = `${baseUrl}/v1/uploads/user`;

        // No progress callback → use the simpler `fetch` path. This
        // is what the admin web app and any non-mobile consumer hits.
        // `fetch` automatically sets the multipart boundary header.
        if (!opts?.onProgress) {
          const res = await fetch(url, { method: 'POST', headers, body });
          await throwIfRateLimited(res, 'upload.direct');
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`upload ${res.status}: ${text.slice(0, 200)}`);
          }
          const json = (await res.json()) as { data: UploadedAssetRef };
          return json.data;
        }

        // Progress requested → fall back to XMLHttpRequest. `fetch` in
        // React Native (and Web) does not expose upload progress —
        // there's no equivalent of `xhr.upload.onprogress`. XHR is
        // available in every JS runtime we ship to (browser, RN,
        // modern Node) so we don't need a polyfill.
        //
        // Lifecycle:
        //   - `xhr.upload.onprogress` fires while the body is being
        //     transmitted. `loaded / total` is the fraction we hand
        //     back to the caller.
        //   - `xhr.onload` fires once the server has fully responded;
        //     this is where we parse + resolve.
        //   - `xhr.onerror` / `xhr.ontimeout` collapse into a single
        //     network-error rejection so the caller's catch handles
        //     both uniformly.
        const onProgress = opts.onProgress;
        return new Promise<UploadedAssetRef>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', url);
          for (const [k, v] of Object.entries(headers)) {
            // Don't set Content-Type; XHR will populate it with the
            // correct multipart boundary when given a FormData body.
            if (k.toLowerCase() === 'content-type') continue;
            xhr.setRequestHeader(k, v);
          }
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) {
              onProgress(Math.min(1, event.loaded / event.total));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const parsed = JSON.parse(xhr.responseText) as { data: UploadedAssetRef };
                // Make sure listeners observe a clean 1.0 frame even if
                // the last `progress` event reported 0.99 (common with
                // server-side buffering between TLS close and headers).
                onProgress(1);
                resolve(parsed.data);
              } catch (err) {
                reject(new Error(`upload: malformed response: ${(err as Error).message}`));
              }
            } else if (xhr.status === 429) {
              // Mirror the fetch path's typed-error behaviour. XHR exposes
              // `getResponseHeader` for parsing `Retry-After`; missing /
              // junk values fall back to the middleware's documented 60s.
              const headerRaw = xhr.getResponseHeader('Retry-After');
              const parsed = headerRaw ? Number(headerRaw) : NaN;
              const retryAfterSeconds =
                Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 60;
              reject(
                new RateLimitedError({
                  endpoint: 'upload.direct',
                  retryAfterSeconds,
                  responseBody: xhr.responseText ?? '',
                }),
              );
            } else {
              reject(new Error(`upload ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
            }
          };
          xhr.onerror = () => reject(new Error('upload: network error'));
          xhr.ontimeout = () => reject(new Error('upload: timed out'));
          xhr.send(body);
        });
      },
    },

    user: {
      // All four methods hit `/v1/users/me`. They're user-scoped, so we
      // attach the Clerk token eagerly and surface 429s as typed
      // `RateLimitedError`s — the single place this logic now lives,
      // instead of being re-implemented per screen in `useSession`.
      async getMe(): Promise<MeResponse> {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(`${baseUrl}/v1/users/me`, { headers });
        await throwIfRateLimited(res, 'users.me');
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`GET /v1/users/me ${res.status}: ${text.slice(0, 200)}`);
        }
        const json = (await res.json()) as { data: MeResponse };
        return json.data;
      },

      async updateProfile(input: UpdateProfileInput): Promise<MeResponse> {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(`${baseUrl}/v1/users/me`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(input),
        });
        await throwIfRateLimited(res, 'users.update');
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`PATCH /v1/users/me ${res.status}: ${text.slice(0, 200)}`);
        }
        const json = (await res.json()) as { data: MeResponse };
        return json.data;
      },

      async uploadAvatar(file: UploadSource): Promise<MeResponse> {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        // Web callers pass a real Blob/File; React Native passes the
        // `{ uri, name, type }` triple, which RN's `FormData` streams
        // off-disk. Don't set Content-Type — `fetch` fills in the
        // multipart boundary.
        const body = new FormData();
        if (file.file) {
          body.append('file', file.file, file.name);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (body as any).append('file', {
            uri: file.uri,
            name: file.name,
            type: file.type,
          } as unknown as Blob);
        }
        const res = await fetch(`${baseUrl}/v1/users/me/avatar`, {
          method: 'POST',
          headers,
          body,
        });
        await throwIfRateLimited(res, 'users.avatar');
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`POST /v1/users/me/avatar ${res.status}: ${text.slice(0, 200)}`);
        }
        const json = (await res.json()) as { data: MeResponse };
        return json.data;
      },

      async deleteAccount(): Promise<void> {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(`${baseUrl}/v1/users/me`, {
          method: 'DELETE',
          headers,
        });
        await throwIfRateLimited(res, 'users.delete');
        // 204 No Content is the success case; tolerate 200 too.
        if (!res.ok && res.status !== 204) {
          const text = await res.text().catch(() => '');
          throw new Error(`DELETE /v1/users/me ${res.status}: ${text.slice(0, 200)}`);
        }
      },
    },
  };
}
