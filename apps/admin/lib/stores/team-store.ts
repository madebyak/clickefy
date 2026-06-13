/**
 * Team store — superadmin-only staff & role management. Talks to
 * `/v1/admin/team`. Mirrors the other admin stores: methods take a
 * `getToken` from the calling component and patch the cached list in
 * place after each mutation so the table doesn't flicker.
 */

import { create } from 'zustand';

import type {
  AdminPageKey,
  AdminRole,
  AdminTeamListResponse,
  AdminTeamMember,
  AdminUserListItem,
  AdminUserListResponse,
} from '@clickfy/types';

import { apiFetch, ApiError, type TokenGetter } from '@/lib/api';

interface TeamStore {
  members: AdminTeamMember[];
  loading: boolean;
  error: string | null;

  fetchTeam: (getToken: TokenGetter) => Promise<void>;
  setRole: (id: string, role: AdminRole, getToken: TokenGetter) => Promise<void>;
  setPages: (
    id: string,
    grant: AdminPageKey[],
    revoke: AdminPageKey[],
    getToken: TokenGetter,
  ) => Promise<void>;
  promote: (id: string, role: AdminRole, getToken: TokenGetter) => Promise<AdminTeamMember>;
  demote: (id: string, getToken: TokenGetter) => Promise<void>;
  /** Lookup non-staff users by email/name for the "add member" flow. */
  searchUsers: (query: string, getToken: TokenGetter) => Promise<AdminUserListItem[]>;
}

function upsertMember(members: AdminTeamMember[], updated: AdminTeamMember): AdminTeamMember[] {
  const idx = members.findIndex((m) => m.id === updated.id);
  if (idx === -1) return [...members, updated];
  const next = members.slice();
  next[idx] = updated;
  return next;
}

export const useTeamStore = create<TeamStore>((set, get) => ({
  members: [],
  loading: false,
  error: null,

  fetchTeam: async (getToken) => {
    set({ loading: true, error: null });
    try {
      const res = await apiFetch<AdminTeamListResponse>('/v1/admin/team', {
        getToken,
        unwrap: false,
      });
      set({ members: res.data, loading: false });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load team';
      set({ error: message, loading: false });
    }
  },

  setRole: async (id, role, getToken) => {
    const updated = await apiFetch<AdminTeamMember>(`/v1/admin/team/${id}/role`, {
      method: 'PATCH',
      getToken,
      json: { role },
    });
    set((state) => ({ members: upsertMember(state.members, updated) }));
  },

  setPages: async (id, grant, revoke, getToken) => {
    const updated = await apiFetch<AdminTeamMember>(`/v1/admin/team/${id}/pages`, {
      method: 'PATCH',
      getToken,
      json: { grant, revoke },
    });
    set((state) => ({ members: upsertMember(state.members, updated) }));
  },

  promote: async (id, role, getToken) => {
    const updated = await apiFetch<AdminTeamMember>(`/v1/admin/team/${id}/promote`, {
      method: 'POST',
      getToken,
      json: { role },
    });
    set((state) => ({ members: upsertMember(state.members, updated) }));
    return updated;
  },

  demote: async (id, getToken) => {
    await apiFetch(`/v1/admin/team/${id}/demote`, { method: 'POST', getToken, json: {} });
    set((state) => ({ members: state.members.filter((m) => m.id !== id) }));
  },

  searchUsers: async (query, getToken) => {
    const params = new URLSearchParams({ limit: '10' });
    if (query.trim()) params.set('search', query.trim());
    const res = await apiFetch<AdminUserListResponse | AdminUserListItem[]>(
      `/v1/admin/users?${params.toString()}`,
      { getToken },
    );
    const list = Array.isArray(res) ? res : res.data;
    // Exclude users who are already staff (present in the team list).
    const staffIds = new Set(get().members.map((m) => m.id));
    return list.filter((u) => !staffIds.has(u.id) && !u.isDeleted);
  },
}));
