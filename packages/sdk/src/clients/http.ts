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

import type { MobileTemplate } from '@clickfy/types';

import type {
  CatalogCategory,
  CatalogTemplate,
  GenerationProgress,
  JobSubmission,
  JobSubmissionResponse,
  TemplateKind as SdkTemplateKind,
  UserProject,
} from '../types';
import { JobSubmissionError } from '../types';
import type { SDKClient, UploadSource, UploadedAssetRef } from './contract';

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
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: JobProgressWire | null;
  /** New wire format: each output carries its media kind. */
  outputs?: Array<{ url: string; kind: 'image' | 'video' }>;
  error?: JobErrorWire;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
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

export interface HttpClientOptions {
  baseUrl: string;
  /** Bearer token getter (returns null if signed out). */
  getToken?: () => Promise<string | null>;
}

// ─── Wire shapes ──────────────────────────────────────────────────

interface ApiCategoryRow {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  parentId: string | null;
  sortOrder: number;
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
  const sdkKind: SdkTemplateKind = m.kind === 'image_set' ? 'set' : (m.kind as 'image' | 'video');
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    categoryId: m.categoryId,
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
  const { baseUrl, getToken } = options;

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

  return {
    catalog: {
      async listCategories(): Promise<CatalogCategory[]> {
        const json = await get<ApiEnvelope<ApiCategoryRow[]>>('/v1/categories');
        return json.data.map(mapCategory);
      },

      async listTemplates(opts?: { categoryId?: string; cursor?: string | null }) {
        // The mock surface only exposes `categoryId` and `cursor` —
        // the underlying endpoint accepts more, but we keep the SDK
        // method tight so screens don't grow a dependency on the
        // Worker's full filter set.
        const params = new URLSearchParams();
        if (opts?.categoryId) params.set('categoryId', opts.categoryId);
        if (opts?.cursor) params.set('cursor', opts.cursor);
        const qs = params.toString();
        const json = await get<ApiTemplatesEnvelope>(
          `/v1/catalog/templates${qs ? `?${qs}` : ''}`,
        );
        return {
          data: json.data.map(mapTemplate),
          nextCursor: json.nextCursor,
        };
      },

      async getTemplate(id: string): Promise<CatalogTemplate> {
        // `auth: true` so the Worker can resolve `isFavorited`. The
        // endpoint still works unauthenticated (returns the template
        // without favorite state); attaching the token when we have
        // one means the result page heart can render correctly on
        // first paint.
        const json = await get<ApiEnvelope<MobileTemplate & { isFavorited?: boolean }>>(
          `/v1/catalog/templates/${id}`,
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
          `/v1/catalog/sections${qs ? `?${qs}` : ''}`,
        );
        return json.sections.map((s) => ({
          key: s.key,
          title: s.title,
          subtitle: s.subtitle,
          layout: s.layout,
          templates: s.templates.map(mapTemplate),
        }));
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

            const progress: GenerationProgress = {
              jobId: data.jobId,
              status: data.status,
              // The Worker emits `{ stage, totalStages, message }` —
              // we map to the legacy SDK shape so mobile screens
              // don't need to change their consumer interface. The
              // mock and http clients now produce identical shapes.
              stageProgress:
                data.status === 'completed'
                  ? 1
                  : data.status === 'queued'
                    ? 0
                    : 0.5, // intra-stage % isn't reported by Trigger.dev; the UI uses stage count primarily
              stageIndex: data.progress?.stage ?? 0,
              stageCount: data.progress?.totalStages ?? 0,
              stageLabel: data.progress?.message ?? statusFallbackLabel(data.status),
              outputs: data.outputs,
              error: data.error?.message,
            };

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
          if (seen.has(p.templateId)) continue;
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

    uploads: {
      async uploadUserAsset(source: UploadSource): Promise<UploadedAssetRef> {
        // Auth required: the Worker derives the user-scoped R2 prefix
        // from the Clerk session, so we must attach a fresh token.
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (getToken) {
          const token = await getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }

        // React Native's `FormData` accepts the `{ uri, name, type }`
        // triple — the bridge converts it into a multipart part with
        // the file streamed off-disk. Casting through `any` because
        // the DOM TS types don't model this RN-specific form.
        //
        // Don't set `Content-Type: multipart/form-data; boundary=...`
        // manually — `fetch` does that automatically and a manual
        // header would override (and break) the auto-generated
        // boundary.
        const body = new FormData();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (body as any).append('file', {
          uri: source.uri,
          name: source.name,
          type: source.type,
        } as unknown as Blob);

        const res = await fetch(`${baseUrl}/v1/uploads/user`, {
          method: 'POST',
          headers,
          body,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`upload ${res.status}: ${text.slice(0, 200)}`);
        }
        const json = (await res.json()) as { data: UploadedAssetRef };
        return json.data;
      },
    },
  };
}
