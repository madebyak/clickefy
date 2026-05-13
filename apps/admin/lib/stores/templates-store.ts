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

interface TemplatesStore {
  templates: Template[];
  currentTemplate: Template | null;
  loading: boolean;
  error: string | null;

  filters: {
    search: string;
    category: string;
    status: string;
    /** User-facing output kind (image / video / image_set), or '' for all. */
    kind: string;
  };

  fetchTemplates: (getToken: TokenGetter) => Promise<void>;
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
  deleteTemplate: (id: string, getToken: TokenGetter) => Promise<void>;
  duplicateTemplate: (id: string, getToken: TokenGetter) => Promise<Template>;
  publishTemplate: (id: string, getToken: TokenGetter) => Promise<Template>;
  unpublishTemplate: (id: string, getToken: TokenGetter) => Promise<Template>;
  setFilters: (filters: Partial<TemplatesStore['filters']>) => void;
  clearCurrentTemplate: () => void;
}

interface TemplatesListResponse {
  data: Template[];
  nextCursor: string | null;
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
  if (data.authorName !== undefined) payload.authorName = data.authorName;
  if (data.categoryId !== undefined) payload.categoryId = data.categoryId;
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
  return payload;
}

export const useTemplatesStore = create<TemplatesStore>((set, get) => ({
  templates: [],
  currentTemplate: null,
  loading: false,
  error: null,
  filters: {
    search: '',
    category: '',
    status: '',
    kind: '',
  },

  fetchTemplates: async (getToken) => {
    set({ loading: true, error: null });
    try {
      // The Worker returns `{ data, nextCursor }` — `apiFetch` already
      // unwraps the top-level `data` envelope, so we destructure on
      // `data` here and ignore pagination for the v1 admin UI (we'll
      // wire infinite scroll if the catalog grows past ~200 templates).
      const result = await apiFetch<TemplatesListResponse>(
        '/v1/admin/templates?limit=100',
        { getToken },
      );
      // `apiFetch` unwraps a single `data` layer. When the response
      // shape is `{ data: [...], nextCursor }` the unwrap yields the
      // array directly; when the server forgets the envelope we get
      // the object — handle both defensively.
      const rows = Array.isArray(result)
        ? (result as unknown as Template[])
        : result.data;
      set({ templates: rows ?? [], loading: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to fetch templates';
      set({ error: message, loading: false });
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

  deleteTemplate: async (id, getToken) => {
    set({ loading: true, error: null });
    try {
      await apiFetch(`/v1/admin/templates/${id}`, {
        method: 'DELETE',
        getToken,
      });
      set({
        templates: get().templates.filter((t) => t.id !== id),
        currentTemplate:
          get().currentTemplate?.id === id ? null : get().currentTemplate,
        loading: false,
      });
    } catch (err) {
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
      set({
        templates: get().templates.map((t) => (t.id === id ? published : t)),
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
      set({
        templates: get().templates.map((t) => (t.id === id ? drafted : t)),
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
