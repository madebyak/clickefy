/**
 * Monitoring store — superadmin-only oversight of template publishing.
 * Talks to `/v1/admin/monitoring`. Three independent data sets (published
 * templates, the per-admin leaderboard, and the activity feed) live on
 * one store so the Monitoring page can switch tabs without re-mounting.
 */

import { create } from 'zustand';

import type {
  MonitoringActivityEntry,
  MonitoringActivityResponse,
  MonitoringAdminMetric,
  MonitoringAdminMetricsResponse,
  MonitoringPublishedTemplate,
  MonitoringPublishedTemplatesResponse,
  MonitoringSummary,
} from '@clickfy/types';

import { apiFetch, ApiError, type TokenGetter } from '@/lib/api';

const PAGE_SIZE = 30;

export type PublishedSort = 'newest' | 'oldest' | 'title_asc';

interface MonitoringStore {
  // Published templates
  published: MonitoringPublishedTemplate[];
  publishedTotal: number;
  publishedHasMore: boolean;
  publishedLoading: boolean;
  publishedLoadingMore: boolean;
  publishedQuery: string;
  publishedSort: PublishedSort;
  setPublishedQuery: (q: string) => void;
  setPublishedSort: (s: PublishedSort) => void;
  fetchPublished: (getToken: TokenGetter) => Promise<void>;
  loadMorePublished: (getToken: TokenGetter) => Promise<void>;
  setOwner: (templateId: string, ownerId: string, getToken: TokenGetter) => Promise<void>;

  // Leaderboard + overview
  metrics: MonitoringAdminMetric[];
  summary: MonitoringSummary | null;
  metricsLoading: boolean;
  fetchMetrics: (
    getToken: TokenGetter,
    range?: { from?: string; to?: string },
  ) => Promise<void>;

  // Activity feed
  activity: MonitoringActivityEntry[];
  activityTotal: number;
  activityHasMore: boolean;
  activityLoading: boolean;
  activityLoadingMore: boolean;
  fetchActivity: (getToken: TokenGetter) => Promise<void>;
  loadMoreActivity: (getToken: TokenGetter) => Promise<void>;

  error: string | null;
}

function buildPublishedParams(q: string, sort: PublishedSort, offset: number): string {
  const params = new URLSearchParams({
    sort,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (q.trim()) params.set('q', q.trim());
  return params.toString();
}

export const useMonitoringStore = create<MonitoringStore>((set, get) => ({
  published: [],
  publishedTotal: 0,
  publishedHasMore: false,
  publishedLoading: false,
  publishedLoadingMore: false,
  publishedQuery: '',
  publishedSort: 'newest',

  setPublishedQuery: (q) => set({ publishedQuery: q }),
  setPublishedSort: (s) => set({ publishedSort: s }),

  fetchPublished: async (getToken) => {
    set({ publishedLoading: true, error: null });
    try {
      const { publishedQuery, publishedSort } = get();
      const qs = buildPublishedParams(publishedQuery, publishedSort, 0);
      const res = await apiFetch<MonitoringPublishedTemplatesResponse>(
        `/v1/admin/monitoring/published-templates?${qs}`,
        { getToken, unwrap: false },
      );
      set({
        published: res.data,
        publishedTotal: res.meta.total,
        publishedHasMore: res.meta.hasMore,
        publishedLoading: false,
      });
    } catch (err) {
      set({
        publishedLoading: false,
        error: err instanceof ApiError ? err.message : 'Failed to load published templates',
      });
    }
  },

  loadMorePublished: async (getToken) => {
    const { publishedLoadingMore, publishedHasMore, published, publishedQuery, publishedSort } =
      get();
    if (publishedLoadingMore || !publishedHasMore) return;
    set({ publishedLoadingMore: true });
    try {
      const qs = buildPublishedParams(publishedQuery, publishedSort, published.length);
      const res = await apiFetch<MonitoringPublishedTemplatesResponse>(
        `/v1/admin/monitoring/published-templates?${qs}`,
        { getToken, unwrap: false },
      );
      set({
        published: [...get().published, ...res.data],
        publishedTotal: res.meta.total,
        publishedHasMore: res.meta.hasMore,
        publishedLoadingMore: false,
      });
    } catch {
      set({ publishedLoadingMore: false });
    }
  },

  setOwner: async (templateId, ownerId, getToken) => {
    await apiFetch(`/v1/admin/monitoring/published-templates/${templateId}/set-owner`, {
      method: 'POST',
      getToken,
      json: { ownerId },
    });
    // Re-fetch the current page so the new attribution shows.
    await get().fetchPublished(getToken);
  },

  metrics: [],
  summary: null,
  metricsLoading: false,

  fetchMetrics: async (getToken, range) => {
    set({ metricsLoading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (range?.from) params.set('from', range.from);
      if (range?.to) params.set('to', range.to);
      const qs = params.toString();
      const res = await apiFetch<MonitoringAdminMetricsResponse>(
        `/v1/admin/monitoring/admin-metrics${qs ? `?${qs}` : ''}`,
        { getToken, unwrap: false },
      );
      set({ metrics: res.data, summary: res.summary, metricsLoading: false });
    } catch (err) {
      set({
        metricsLoading: false,
        error: err instanceof ApiError ? err.message : 'Failed to load metrics',
      });
    }
  },

  activity: [],
  activityTotal: 0,
  activityHasMore: false,
  activityLoading: false,
  activityLoadingMore: false,

  fetchActivity: async (getToken) => {
    set({ activityLoading: true, error: null });
    try {
      const res = await apiFetch<MonitoringActivityResponse>(
        `/v1/admin/monitoring/activity?limit=${PAGE_SIZE}&offset=0`,
        { getToken, unwrap: false },
      );
      set({
        activity: res.data,
        activityTotal: res.meta.total,
        activityHasMore: res.meta.hasMore,
        activityLoading: false,
      });
    } catch (err) {
      set({
        activityLoading: false,
        error: err instanceof ApiError ? err.message : 'Failed to load activity',
      });
    }
  },

  loadMoreActivity: async (getToken) => {
    const { activityLoadingMore, activityHasMore, activity } = get();
    if (activityLoadingMore || !activityHasMore) return;
    set({ activityLoadingMore: true });
    try {
      const res = await apiFetch<MonitoringActivityResponse>(
        `/v1/admin/monitoring/activity?limit=${PAGE_SIZE}&offset=${activity.length}`,
        { getToken, unwrap: false },
      );
      set({
        activity: [...get().activity, ...res.data],
        activityTotal: res.meta.total,
        activityHasMore: res.meta.hasMore,
        activityLoadingMore: false,
      });
    } catch {
      set({ activityLoadingMore: false });
    }
  },

  error: null,
}));
