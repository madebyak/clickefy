/**
 * Users store — admin-side. Talks to `/v1/admin/users`.
 *
 * Mirrors the templates / categories stores: read + mutate methods that
 * accept a `getToken` from the calling component (zustand stores live
 * outside React, so they can't call `useAuth` themselves). Each
 * mutation re-fetches just the affected row's stats by replacing it in
 * the cached list — no full re-list — so the table doesn't flicker.
 */

import { create } from 'zustand';

import type {
  AdjustCreditsInput,
  AdminUserDetail,
  AdminUserListItem,
  AdminUserListResponse,
  SetEntitlementInput,
  UserEntitlement,
} from '@clickfy/types';

import { apiFetch, ApiError, type TokenGetter } from '@/lib/api';

export interface UsersFilters {
  search: string;
  /** Inclusive lower bound on `creditsBalance`, or empty string for unset. */
  creditsMin: string;
  /** Inclusive upper bound on `creditsBalance`, or empty string for unset. */
  creditsMax: string;
}

interface UsersStore {
  users: AdminUserListItem[];
  total: number | null;
  loading: boolean;
  error: string | null;
  filters: UsersFilters;

  detail: AdminUserDetail | null;
  detailLoading: boolean;
  detailError: string | null;

  fetchUsers: (getToken: TokenGetter) => Promise<void>;
  setFilters: (patch: Partial<UsersFilters>) => void;

  fetchDetail: (id: string, getToken: TokenGetter) => Promise<AdminUserDetail | null>;
  clearDetail: () => void;

  adjustCredits: (
    id: string,
    body: AdjustCreditsInput,
    getToken: TokenGetter,
  ) => Promise<void>;
  setEntitlement: (
    id: string,
    entitlement: UserEntitlement,
    getToken: TokenGetter,
  ) => Promise<void>;
  banUser: (id: string, getToken: TokenGetter) => Promise<void>;
  unbanUser: (id: string, getToken: TokenGetter) => Promise<void>;
  softDeleteUser: (id: string, getToken: TokenGetter) => Promise<void>;
  hardDeleteUser: (id: string, getToken: TokenGetter) => Promise<void>;
}

function buildQuery(filters: UsersFilters): string {
  const params = new URLSearchParams();
  params.set('limit', '100');
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.creditsMin.trim() !== '') params.set('creditsMin', filters.creditsMin.trim());
  if (filters.creditsMax.trim() !== '') params.set('creditsMax', filters.creditsMax.trim());
  return params.toString();
}

export const useUsersStore = create<UsersStore>((set, get) => ({
  users: [],
  total: null,
  loading: false,
  error: null,
  filters: {
    search: '',
    creditsMin: '',
    creditsMax: '',
  },

  detail: null,
  detailLoading: false,
  detailError: null,

  fetchUsers: async (getToken) => {
    set({ loading: true, error: null });
    try {
      const qs = buildQuery(get().filters);
      // `apiFetch` peels one `data` envelope. Server returns
      // `{ data: [...], nextCursor, total }` so the unwrap leaves us
      // with the array directly; pagination cursors aren't surfaced
      // in the v1 admin UI yet (we cap at limit=100 server-side).
      const result = await apiFetch<AdminUserListResponse | AdminUserListItem[]>(
        `/v1/admin/users?${qs}`,
        { getToken },
      );

      if (Array.isArray(result)) {
        set({ users: result, total: result.length, loading: false });
      } else {
        set({
          users: result.data,
          total: result.total ?? result.data.length,
          loading: false,
        });
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to fetch users';
      set({ error: message, loading: false });
    }
  },

  setFilters: (patch) =>
    set((state) => ({ filters: { ...state.filters, ...patch } })),

  fetchDetail: async (id, getToken) => {
    set({ detailLoading: true, detailError: null });
    try {
      const detail = await apiFetch<AdminUserDetail>(
        `/v1/admin/users/${id}`,
        { getToken },
      );
      set({ detail, detailLoading: false });
      return detail;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load user';
      set({ detailError: message, detailLoading: false, detail: null });
      return null;
    }
  },

  clearDetail: () => set({ detail: null, detailError: null }),

  adjustCredits: async (id, body, getToken) => {
    const result = await apiFetch<{ creditsBalance: number; delta: number }>(
      `/v1/admin/users/${id}/credits`,
      { method: 'POST', getToken, json: body },
    );
    // Optimistic local update so the table reflects the change without
    // a re-fetch. `creditsSpent` only moves on negative deltas.
    set((state) => ({
      users: state.users.map((u) =>
        u.id === id
          ? {
              ...u,
              creditsBalance: result.creditsBalance,
              creditsSpent:
                body.delta < 0 ? u.creditsSpent + Math.abs(body.delta) : u.creditsSpent,
            }
          : u,
      ),
      detail:
        state.detail && state.detail.id === id
          ? { ...state.detail, creditsBalance: result.creditsBalance }
          : state.detail,
    }));
  },

  setEntitlement: async (id, entitlement, getToken) => {
    const body: SetEntitlementInput = { entitlement };
    await apiFetch(`/v1/admin/users/${id}/entitlement`, {
      method: 'PATCH',
      getToken,
      json: body,
    });
    set((state) => ({
      users: state.users.map((u) =>
        u.id === id ? { ...u, entitlement } : u,
      ),
      detail:
        state.detail && state.detail.id === id
          ? { ...state.detail, entitlement }
          : state.detail,
    }));
  },

  banUser: async (id, getToken) => {
    await apiFetch(`/v1/admin/users/${id}/ban`, {
      method: 'POST',
      getToken,
      json: {},
    });
    set((state) => ({
      detail:
        state.detail && state.detail.id === id && state.detail.clerk
          ? { ...state.detail, clerk: { ...state.detail.clerk, banned: true } }
          : state.detail,
    }));
  },

  unbanUser: async (id, getToken) => {
    await apiFetch(`/v1/admin/users/${id}/unban`, {
      method: 'POST',
      getToken,
      json: {},
    });
    set((state) => ({
      detail:
        state.detail && state.detail.id === id && state.detail.clerk
          ? { ...state.detail, clerk: { ...state.detail.clerk, banned: false } }
          : state.detail,
    }));
  },

  softDeleteUser: async (id, getToken) => {
    await apiFetch<{ isDeleted: boolean; purgeAssetsAt: string | null }>(
      `/v1/admin/users/${id}/soft-delete`,
      { method: 'POST', getToken, json: {} },
    );
    set((state) => ({
      users: state.users.map((u) =>
        u.id === id ? { ...u, isDeleted: true } : u,
      ),
    }));
  },

  hardDeleteUser: async (id, getToken) => {
    await apiFetch(`/v1/admin/users/${id}`, {
      method: 'DELETE',
      getToken,
    });
    set((state) => ({
      users: state.users.filter((u) => u.id !== id),
      total: state.total !== null ? Math.max(0, state.total - 1) : null,
      detail: state.detail && state.detail.id === id ? null : state.detail,
    }));
  },
}));
