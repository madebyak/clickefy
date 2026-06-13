/**
 * Permissions store — loads the signed-in staff member's context from
 * `GET /v1/admin/me` once on boot and exposes it app-wide.
 *
 * This drives client-side affordances only: which nav items show, the
 * footer identity/role badge, and the deep-link route guard. The API
 * re-checks every request server-side, so a tampered client can never
 * actually reach a forbidden endpoint — this is UX, not the gate.
 */

import { create } from 'zustand';

import type { AdminMe, AdminPageKey, AdminRole } from '@clickfy/types';

import { apiFetch, ApiError, type TokenGetter } from '@/lib/api';

export type PermissionsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PermissionsStore {
  me: AdminMe | null;
  status: PermissionsStatus;
  /** HTTP status of the failure, when `status === 'error'`. */
  errorStatus: number | null;
  error: string | null;

  fetchMe: (getToken: TokenGetter) => Promise<void>;
  reset: () => void;
}

export const usePermissionsStore = create<PermissionsStore>((set, get) => ({
  me: null,
  status: 'idle',
  errorStatus: null,
  error: null,

  fetchMe: async (getToken) => {
    // Only fetch once per session unless we previously errored.
    const { status } = get();
    if (status === 'loading' || status === 'ready') return;

    set({ status: 'loading', error: null, errorStatus: null });
    try {
      const me = await apiFetch<AdminMe>('/v1/admin/me', { getToken });
      set({ me, status: 'ready' });
    } catch (err) {
      if (err instanceof ApiError) {
        set({ status: 'error', error: err.message, errorStatus: err.status });
      } else {
        set({ status: 'error', error: 'Failed to load permissions', errorStatus: null });
      }
    }
  },

  reset: () => set({ me: null, status: 'idle', error: null, errorStatus: null }),
}));

/** Whether the current user's effective pages include `page`. */
export function useCan(): (page: AdminPageKey) => boolean {
  const me = usePermissionsStore((s) => s.me);
  return (page: AdminPageKey) => me?.pages.includes(page) ?? false;
}

/** The current user's role, or null until loaded. */
export function useAdminRole(): AdminRole | null {
  return usePermissionsStore((s) => s.me?.role ?? null);
}
