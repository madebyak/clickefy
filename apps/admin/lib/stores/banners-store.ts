/**
 * Banners store — talks to `/v1/admin/banners` (Worker → Neon).
 *
 * Same shape as `categories-store.ts`: every mutation accepts a
 * `getToken` from the calling component (Clerk hooks live in React;
 * stores live outside it). Optimistic updates on reorder so DnD
 * feels instant.
 */

import { create } from 'zustand';

import {
  createBanner,
  deleteBanner,
  fetchBanners,
  reorderBanners,
  updateBanner,
  type CreateBannerInput,
  type HomeBanner,
  type UpdateBannerInput,
} from '@/lib/api/banners';
import { ApiError, type TokenGetter } from '@/lib/api';

interface BannersStore {
  banners: HomeBanner[];
  loading: boolean;
  error: string | null;

  fetchBanners: (getToken: TokenGetter) => Promise<void>;
  createBanner: (input: CreateBannerInput, getToken: TokenGetter) => Promise<HomeBanner>;
  updateBanner: (
    id: string,
    input: UpdateBannerInput,
    getToken: TokenGetter,
  ) => Promise<HomeBanner>;
  deleteBanner: (id: string, getToken: TokenGetter) => Promise<void>;
  reorderBanners: (newOrder: HomeBanner[], getToken: TokenGetter) => Promise<void>;
}

export const useBannersStore = create<BannersStore>((set, get) => ({
  banners: [],
  loading: false,
  error: null,

  fetchBanners: async (getToken) => {
    set({ loading: true, error: null });
    try {
      const data = await fetchBanners(getToken);
      set({ banners: data, loading: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to fetch banners';
      set({ error: message, loading: false });
    }
  },

  createBanner: async (input, getToken) => {
    set({ loading: true, error: null });
    try {
      const created = await createBanner(input, getToken);
      set({ banners: [...get().banners, created], loading: false });
      return created;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to create banner';
      set({ error: message, loading: false });
      throw err;
    }
  },

  updateBanner: async (id, input, getToken) => {
    set({ loading: true, error: null });
    try {
      const updated = await updateBanner(id, input, getToken);
      set({
        banners: get().banners.map((b) => (b.id === id ? updated : b)),
        loading: false,
      });
      return updated;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to update banner';
      set({ error: message, loading: false });
      throw err;
    }
  },

  deleteBanner: async (id, getToken) => {
    set({ loading: true, error: null });
    try {
      await deleteBanner(id, getToken);
      set({
        banners: get().banners.filter((b) => b.id !== id),
        loading: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to delete banner';
      set({ error: message, loading: false });
      throw err;
    }
  },

  reorderBanners: async (newOrder, getToken) => {
    // Optimistic — DnD must feel instant. Reassign sortOrder to the
    // index so the local list matches what the server is about to write.
    const previous = get().banners;
    const stamped = newOrder.map((b, idx) => ({ ...b, sortOrder: idx }));
    set({ banners: stamped, loading: true, error: null });
    try {
      await reorderBanners(
        newOrder.map((b) => b.id),
        getToken,
      );
      set({ loading: false });
    } catch (err) {
      set({ banners: previous, error: 'Failed to reorder banners', loading: false });
      throw err;
    }
  },
}));
