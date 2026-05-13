import { create } from 'zustand';
import type { Category, CategoryFormData } from '@clickfy/types';
import { apiFetch, ApiError, type TokenGetter } from '@/lib/api';

/**
 * Categories store — talks to the Cloudflare Worker API (Neon-backed).
 *
 * Every mutation requires a Clerk session token, which the calling component
 * passes in via `getToken` (obtained from `useAuth()`). We don't grab the
 * token inside the store because zustand stores live outside the React tree
 * and shouldn't bind to a specific hook context.
 */

interface CategoriesStore {
  categories: Category[];
  loading: boolean;
  error: string | null;

  fetchCategories: () => Promise<void>;
  createCategory: (data: CategoryFormData, getToken: TokenGetter) => Promise<void>;
  updateCategory: (
    id: string,
    data: Partial<CategoryFormData>,
    getToken: TokenGetter,
  ) => Promise<void>;
  deleteCategory: (id: string, getToken: TokenGetter) => Promise<void>;
  reorderCategories: (
    reordered: Category[],
    getToken: TokenGetter,
  ) => Promise<void>;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function toServerPayload(data: CategoryFormData) {
  return {
    name: data.name,
    slug: data.slug?.trim() || slugify(data.name),
    iconUrl: data.iconUrl ?? null,
    parentId: data.parentId ?? null,
    sortOrder: data.sortOrder ?? 0,
  };
}

export const useCategoriesStore = create<CategoriesStore>((set, get) => ({
  categories: [],
  loading: false,
  error: null,

  fetchCategories: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiFetch<Category[]>('/v1/categories');
      set({ categories: data, loading: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to fetch categories';
      set({ error: message, loading: false });
    }
  },

  createCategory: async (data, getToken) => {
    set({ loading: true, error: null });
    try {
      const created = await apiFetch<Category>('/v1/categories', {
        method: 'POST',
        getToken,
        json: toServerPayload(data),
      });
      set({ categories: [...get().categories, created], loading: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to create category';
      set({ error: message, loading: false });
      throw err;
    }
  },

  updateCategory: async (id, data, getToken) => {
    set({ loading: true, error: null });
    try {
      const payload: Record<string, unknown> = {};
      if (data.name !== undefined) payload.name = data.name;
      if (data.slug !== undefined)
        payload.slug = data.slug.trim() || (data.name ? slugify(data.name) : undefined);
      if (data.iconUrl !== undefined) payload.iconUrl = data.iconUrl;
      if (data.parentId !== undefined) payload.parentId = data.parentId;
      if (data.sortOrder !== undefined) payload.sortOrder = data.sortOrder;

      const updated = await apiFetch<Category>(`/v1/categories/${id}`, {
        method: 'PATCH',
        getToken,
        json: payload,
      });
      set({
        categories: get().categories.map((c) => (c.id === id ? updated : c)),
        loading: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to update category';
      set({ error: message, loading: false });
      throw err;
    }
  },

  deleteCategory: async (id, getToken) => {
    set({ loading: true, error: null });
    const hasChildren = get().categories.some((c) => c.parentId === id);
    if (hasChildren) {
      const msg = 'Cannot delete category with sub-categories';
      set({ error: msg, loading: false });
      throw new Error(msg);
    }
    try {
      await apiFetch<{ id: string; deleted: boolean }>(
        `/v1/categories/${id}`,
        { method: 'DELETE', getToken },
      );
      set({
        categories: get().categories.filter((c) => c.id !== id),
        loading: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to delete category';
      set({ error: message, loading: false });
      throw err;
    }
  },

  reorderCategories: async (reordered, getToken) => {
    // Optimistic local update first — DnD must feel instant.
    const previous = get().categories;
    // Reassign `sortOrder` to the index so the local list stays in sync
    // with what the server is about to write.
    const stamped = reordered.map((cat, idx) => ({ ...cat, sortOrder: idx }));
    set({ categories: stamped, loading: true, error: null });
    try {
      await apiFetch('/v1/categories/reorder', {
        method: 'POST',
        getToken,
        json: { ids: reordered.map((c) => c.id) },
      });
      set({ loading: false });
    } catch (err) {
      set({ categories: previous, error: 'Failed to reorder categories', loading: false });
      throw err;
    }
  },
}));
