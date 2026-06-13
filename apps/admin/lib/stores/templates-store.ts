/**
 * Templates store — talks to the Cloudflare Worker API (Neon-backed).
 *
 * Mirrors `categories-store.ts`: every mutation requires a Clerk
 * session token, which the calling component passes in via `getToken`
 * obtained from `useAuth()`. We don't grab the token inside the store
 * because zustand stores live outside the React tree.
 *
 * Read operations (`fetchTemplates`, `fetchTemplate`) also require
 * `getToken` because the admin listing endpoint is admin-gated (it
 * returns drafts and archived rows). The mobile-facing equivalent is
 * `/v1/catalog/templates`, which is unauthenticated.
 *
 * Persistence rules — only the canonical shape goes over the wire:
 *   - `GenerationReference.base64 / mimeType / fileName` are
 *     authoring-only working state. They live in zustand while the
 *     R2 upload is in flight; once the upload completes the ref
 *     swaps to `r2Key` only. {@link sanitizeGeneration} below is a
 *     belt-and-suspenders strip in case any transient field leaks
 *     through (the Worker route does the same strip server-side).
 */

import { create } from 'zustand';

import type {
  GenerationReference,
  GenerationStage,
  Template,
  TemplateFormData,
  TemplateGeneration,
} from '@clickfy/types';

import { apiFetch, ApiError, type TokenGetter } from '@/lib/api';

/** How many rows we request per page from the admin listing endpoint. */
const PAGE_SIZE = 30;

/** Server-supported orderings for the admin grid. Mirrors the `sort`
 *  enum on `GET /v1/admin/templates`. */
export type TemplateSort = 'newest' | 'oldest' | 'title_asc' | 'manual';

interface TemplatesStore {
  templates: Template[];
  currentTemplate: Template | null;
  loading: boolean;
  /** True while a Load-more (append) request is in flight. */
  loadingMore: boolean;
  /** Total rows matching the active filters (across all pages). */
  total: number;
  /** Whether more rows exist past what's currently loaded. */
  hasMore: boolean;
  error: string | null;

  filters: {
    search: string;
    category: string;
    status: string;
    /** User-facing output kind (image / video / image_set), or '' for all. */
    kind: string;
    /** Server-side ordering for the grid. */
    sort: TemplateSort;
    /**
     * Mix archived rows into the listing alongside drafts/published.
     * When false (the default), the API filters them out — the admin's
     * primary view stays focused on live work. Picking the explicit
     * `Archived` chip in the status filter still works regardless of
     * this toggle (server treats explicit `status` as the override).
     */
    includeArchived: boolean;
  };

  /** Fetch the first page for the current filters (replaces the list). */
  fetchTemplates: (getToken: TokenGetter) => Promise<void>;
  /** Append the next page to the current list (Load more). */
  loadMore: (getToken: TokenGetter) => Promise<void>;
  fetchTemplate: (id: string, getToken: TokenGetter) => Promise<Template | null>;
  createTemplate: (
    data: TemplateFormData,
    getToken: TokenGetter,
  ) => Promise<Template>;
  updateTemplate: (
    id: string,
    data: Partial<TemplateFormData>,
    getToken: TokenGetter,
  ) => Promise<Template>;
  /**
   * Soft-archive: hides the template from the public catalog and from
   * the default admin view, but keeps every row that references it
   * (jobs, library entries, version history) intact. Reversible via
   * {@link restoreTemplate}.
   */
  archiveTemplate: (id: string, getToken: TokenGetter) => Promise<Template>;
  /** Bring an archived template back as a draft. */
  restoreTemplate: (id: string, getToken: TokenGetter) => Promise<Template>;
  /**
   * Permanent hard-delete. The API refuses with `template_in_use`
   * (HTTP 409) when any job has ever referenced the template; the
   * caller surfaces that as a "Archive instead" toast.
   */
  purgeTemplate: (id: string, getToken: TokenGetter) => Promise<void>;
  duplicateTemplate: (id: string, getToken: TokenGetter) => Promise<Template>;
  publishTemplate: (id: string, getToken: TokenGetter) => Promise<Template>;
  unpublishTemplate: (id: string, getToken: TokenGetter) => Promise<Template>;
  setFilters: (filters: Partial<TemplatesStore['filters']>) => void;
  clearCurrentTemplate: () => void;
}

interface TemplatesListResponse {
  data: Template[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Translate the store's filter state into the query string the admin
 * listing endpoint expects. Empty / sentinel values are omitted so the
 * server applies its defaults. Search and category/status/kind all run
 * server-side now (the grid renders exactly what the API returns), so
 * this is the single source of truth for "what is being asked for".
 */
function buildListParams(
  filters: TemplatesStore['filters'],
  offset: number,
): URLSearchParams {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
    sort: filters.sort,
  });
  const search = filters.search.trim();
  if (search) params.set('search', search);
  if (filters.status) params.set('status', filters.status);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.category) params.set('categoryId', filters.category);
  // `includeArchived` only matters when no explicit status is set —
  // the server treats an explicit `status` (incl. `archived`) as the
  // override. Sending it anyway is harmless, but we keep the wire tidy.
  if (filters.includeArchived && !filters.status) {
    params.set('includeArchived', 'true');
  }
  return params;
}

/**
 * Strip in-memory authoring fields from references before persisting.
 * Keeps the wire payload tight and ensures we don't accidentally
 * persist base64 image data into Postgres (it would bloat the row by
 * megabytes per reference). The Worker route applies the same strip
 * server-side as a safety net.
 */
function sanitizeReference(ref: GenerationReference): GenerationReference {
  const clean: GenerationReference = {
    id: ref.id,
    key: ref.key,
    role: ref.role,
  };
  if (ref.r2Key) clean.r2Key = ref.r2Key;
  if (ref.label && ref.label.length > 0) clean.label = ref.label;
  return clean;
}

function sanitizeStage(stage: GenerationStage): GenerationStage {
  return {
    ...stage,
    references: stage.references.map(sanitizeReference),
  };
}

function sanitizeGeneration(generation: TemplateGeneration): TemplateGeneration {
  return {
    mode: generation.mode,
    stages: generation.stages.map(sanitizeStage),
  };
}

/**
 * Build the JSON body the Worker's create / update routes accept.
 * Only keys the admin actually populated are included — `undefined`
 * values are dropped so PATCH semantics work cleanly (Drizzle would
 * happily NULL a column otherwise).
 */
function toServerPayload(
  data: Partial<TemplateFormData>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (data.title !== undefined) payload.title = data.title;
  if (data.slug !== undefined) payload.slug = data.slug;
  if (data.description !== undefined) payload.description = data.description;
  // Many-to-many category fields. We always send both the new explicit
  // pair and the legacy `categoryId` (= primary) so a brief deploy
  // skew between admin and API still works.
  if (data.primaryCategoryId !== undefined) {
    payload.primaryCategoryId = data.primaryCategoryId;
    payload.categoryId = data.primaryCategoryId;
  } else if (data.categoryId !== undefined) {
    payload.primaryCategoryId = data.categoryId;
    payload.categoryId = data.categoryId;
  }
  if (data.extraCategoryIds !== undefined) {
    payload.extraCategoryIds = data.extraCategoryIds;
  }
  if (data.kind !== undefined) payload.kind = data.kind;
  if (data.featured !== undefined) payload.featured = data.featured;
  if (data.coverMedia !== undefined) payload.coverMedia = data.coverMedia;
  if (data.previewVideo !== undefined) payload.previewVideo = data.previewVideo;
  if (data.gallery !== undefined) payload.gallery = data.gallery;
  if (data.userInputs !== undefined) payload.userInputs = data.userInputs;
  if (data.userCanChooseAspectRatio !== undefined) {
    payload.userCanChooseAspectRatio = data.userCanChooseAspectRatio;
  }
  if (data.defaultAspectRatio !== undefined) {
    payload.defaultAspectRatio = data.defaultAspectRatio;
  }
  if (data.generation !== undefined) {
    payload.generation = sanitizeGeneration(data.generation);
  }
  if (data.output !== undefined) payload.output = data.output;
  if (data.costCredits !== undefined) payload.costCredits = data.costCredits;
  if (data.sortOrder !== undefined) payload.sortOrder = data.sortOrder;
  // Non-English overrides. Only sent when the form actually carries the
  // key (loaded from the row or edited in the Arabic fields) so a bare
  // PATCH never NULLs existing translations.
  if (data.translations !== undefined) payload.translations = data.translations;
  return payload;
}

export const useTemplatesStore = create<TemplatesStore>((set, get) => ({
  templates: [],
  currentTemplate: null,
  loading: false,
  loadingMore: false,
  total: 0,
  hasMore: false,
  error: null,
  filters: {
    search: '',
    category: '',
    status: '',
    kind: '',
    sort: 'newest',
    includeArchived: false,
  },

  fetchTemplates: async (getToken) => {
    set({ loading: true, error: null });
    try {
      // All filtering, search and ordering happen server-side — the
      // grid renders exactly the page the API returns. We pass
      // `unwrap: false` so we keep the `{ data, meta }` envelope; the
      // default unwrap would hand back just the array and drop the
      // pagination metadata we need for Load-more / the count.
      const params = buildListParams(get().filters, 0);
      const result = await apiFetch<TemplatesListResponse>(
        `/v1/admin/templates?${params.toString()}`,
        { getToken, unwrap: false },
      );
      // Defensive: tolerate a bare array if the server ever drops the
      // envelope (older deploy), falling back to sane meta defaults.
      const rows = Array.isArray(result)
        ? (result as unknown as Template[])
        : (result.data ?? []);
      const meta = Array.isArray(result) ? undefined : result.meta;
      set({
        templates: rows,
        total: meta?.total ?? rows.length,
        hasMore: meta?.hasMore ?? false,
        loading: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to fetch templates';
      set({ error: message, loading: false });
    }
  },

  loadMore: async (getToken) => {
    // Guard against double-fires (rapid clicks / in-flight fetch).
    if (get().loadingMore || get().loading || !get().hasMore) return;
    set({ loadingMore: true, error: null });
    try {
      const offset = get().templates.length;
      const params = buildListParams(get().filters, offset);
      const result = await apiFetch<TemplatesListResponse>(
        `/v1/admin/templates?${params.toString()}`,
        { getToken, unwrap: false },
      );
      const rows = Array.isArray(result)
        ? (result as unknown as Template[])
        : (result.data ?? []);
      const meta = Array.isArray(result) ? undefined : result.meta;
      // De-dupe on id — concurrent edits could shift offsets and
      // re-serve a row we already hold; never render it twice.
      const seen = new Set(get().templates.map((t) => t.id));
      const fresh = rows.filter((r) => !seen.has(r.id));
      set({
        templates: [...get().templates, ...fresh],
        total: meta?.total ?? get().total,
        hasMore: meta?.hasMore ?? false,
        loadingMore: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load more templates';
      set({ error: message, loadingMore: false });
    }
  },

  fetchTemplate: async (id, getToken) => {
    set({ loading: true, error: null });
    try {
      const row = await apiFetch<Template>(`/v1/admin/templates/${id}`, {
        getToken,
      });
      set({ currentTemplate: row, loading: false });
      return row;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to fetch template';
      set({ error: message, loading: false, currentTemplate: null });
      return null;
    }
  },

  createTemplate: async (data, getToken) => {
    set({ loading: true, error: null });
    try {
      const created = await apiFetch<Template>('/v1/admin/templates', {
        method: 'POST',
        getToken,
        json: toServerPayload(data),
      });
      set({
        templates: [created, ...get().templates],
        total: get().total + 1,
        currentTemplate: created,
        loading: false,
      });
      return created;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to create template';
      set({ error: message, loading: false });
      throw err;
    }
  },

  updateTemplate: async (id, data, getToken) => {
    set({ loading: true, error: null });
    try {
      const updated = await apiFetch<Template>(`/v1/admin/templates/${id}`, {
        method: 'PATCH',
        getToken,
        json: toServerPayload(data),
      });
      set({
        templates: get().templates.map((t) => (t.id === id ? updated : t)),
        currentTemplate:
          get().currentTemplate?.id === id ? updated : get().currentTemplate,
        loading: false,
      });
      return updated;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to update template';
      set({ error: message, loading: false });
      throw err;
    }
  },

  archiveTemplate: async (id, getToken) => {
    set({ loading: true, error: null });
    try {
      const archived = await apiFetch<Template>(`/v1/admin/templates/${id}`, {
        method: 'DELETE',
        getToken,
      });
      // If archived rows aren't currently in view, drop the row from
      // the local list so it disappears from the grid; otherwise keep
      // it (with the new status badge) so the admin can see what just
      // happened and click Restore if it was a misfire.
      const showArchived =
        get().filters.includeArchived || get().filters.status === 'archived';
      const dropped = !showArchived;
      set({
        templates: dropped
          ? get().templates.filter((t) => t.id !== id)
          : get().templates.map((t) => (t.id === id ? archived : t)),
        total: dropped ? Math.max(0, get().total - 1) : get().total,
        currentTemplate:
          get().currentTemplate?.id === id ? archived : get().currentTemplate,
        loading: false,
      });
      return archived;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to archive template';
      set({ error: message, loading: false });
      throw err;
    }
  },

  restoreTemplate: async (id, getToken) => {
    set({ loading: true, error: null });
    try {
      const restored = await apiFetch<Template>(
        `/v1/admin/templates/${id}/restore`,
        { method: 'POST', getToken },
      );
      // The server returns the row as `draft`. If the current view is
      // filtered to "Archived only" the row no longer matches; drop
      // it. Otherwise keep it (with the new draft status).
      const archivedOnlyView = get().filters.status === 'archived';
      set({
        templates: archivedOnlyView
          ? get().templates.filter((t) => t.id !== id)
          : get().templates.map((t) => (t.id === id ? restored : t)),
        total: archivedOnlyView ? Math.max(0, get().total - 1) : get().total,
        currentTemplate:
          get().currentTemplate?.id === id ? restored : get().currentTemplate,
        loading: false,
      });
      return restored;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to restore template';
      set({ error: message, loading: false });
      throw err;
    }
  },

  purgeTemplate: async (id, getToken) => {
    set({ loading: true, error: null });
    try {
      await apiFetch(`/v1/admin/templates/${id}/purge`, {
        method: 'DELETE',
        getToken,
      });
      set({
        templates: get().templates.filter((t) => t.id !== id),
        total: Math.max(0, get().total - 1),
        currentTemplate:
          get().currentTemplate?.id === id ? null : get().currentTemplate,
        loading: false,
      });
    } catch (err) {
      // Surface the API-side `template_in_use` (409) message verbatim
      // — the caller renders it as a toast that explains why purge
      // is refused and suggests Archive as the alternative.
      const message =
        err instanceof ApiError ? err.message : 'Failed to delete template';
      set({ error: message, loading: false });
      throw err;
    }
  },

  duplicateTemplate: async (id, getToken) => {
    set({ loading: true, error: null });
    try {
      const cloned = await apiFetch<Template>(
        `/v1/admin/templates/${id}/duplicate`,
        { method: 'POST', getToken },
      );
      set({
        templates: [cloned, ...get().templates],
        total: get().total + 1,
        loading: false,
      });
      return cloned;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to duplicate template';
      set({ error: message, loading: false });
      throw err;
    }
  },

  publishTemplate: async (id, getToken) => {
    set({ loading: true, error: null });
    try {
      const published = await apiFetch<Template>(
        `/v1/admin/templates/${id}/publish`,
        { method: 'POST', getToken, json: {} },
      );
      // If the grid is filtered to a status this row no longer matches
      // (e.g. "Draft" view, row just became "published"), drop it from
      // view; otherwise update it in place.
      const dropped = get().filters.status === 'draft';
      set({
        templates: dropped
          ? get().templates.filter((t) => t.id !== id)
          : get().templates.map((t) => (t.id === id ? published : t)),
        total: dropped ? Math.max(0, get().total - 1) : get().total,
        currentTemplate:
          get().currentTemplate?.id === id ? published : get().currentTemplate,
        loading: false,
      });
      return published;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to publish template';
      set({ error: message, loading: false });
      throw err;
    }
  },

  unpublishTemplate: async (id, getToken) => {
    set({ loading: true, error: null });
    try {
      const drafted = await apiFetch<Template>(
        `/v1/admin/templates/${id}/unpublish`,
        { method: 'POST', getToken },
      );
      // Mirror publish: if the grid is filtered to "Published", the
      // now-draft row no longer belongs — drop it from view.
      const dropped = get().filters.status === 'published';
      set({
        templates: dropped
          ? get().templates.filter((t) => t.id !== id)
          : get().templates.map((t) => (t.id === id ? drafted : t)),
        total: dropped ? Math.max(0, get().total - 1) : get().total,
        currentTemplate:
          get().currentTemplate?.id === id ? drafted : get().currentTemplate,
        loading: false,
      });
      return drafted;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to unpublish template';
      set({ error: message, loading: false });
      throw err;
    }
  },

  setFilters: (newFilters) =>
    set((state) => ({ filters: { ...state.filters, ...newFilters } })),

  clearCurrentTemplate: () => set({ currentTemplate: null }),
}));
