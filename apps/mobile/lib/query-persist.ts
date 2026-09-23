/**
 * query-persist — React Query's cache, saved to disk between launches.
 *
 * A cold start used to be a blank screen until the network answered;
 * now Home, Projects and an open project paint from the last-known
 * data at once and refresh silently behind it (stale-while-revalidate
 * — the Instagram cold-start model). `staleTime` still decides when a
 * refetch happens; persistence only changes what is on screen while it
 * does.
 *
 * What is persisted is an allow-list, not everything:
 *   • lists and content the user sees on open (projects, an open
 *     project's assets, the home feed, models, the profile/balance)
 *   • never per-job polling (`job`), search results, store/RevenueCat
 *     state or anything else that is transient or already refetched
 *     on every open
 * and only queries that succeeded — an error is never replayed.
 *
 * `maxAge` bounds how old a restored entry may be; `gcTime` on the
 * client must be at least as long, or entries are collected in memory
 * before the persister gets to them (see the QueryClient defaults).
 *
 * Sign-out clears the in-memory cache (`useSession`), and the persister
 * writes that emptied state, so a second account on the same device
 * never sees the first one's lists.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';

/** Bump when the shape of a persisted query changes incompatibly. */
const CACHE_VERSION = 'v1';
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60_000;

const PERSISTED_KEY_PREFIXES = new Set([
  'projects',
  'studio-projects',
  'project-assets',
  'users',
  'models',
  'categories',
  'home-sections',
  'home-banners',
]);

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'clickefy:query-cache',
  // Coalesce the burst of writes a screen full of queries produces.
  throttleTime: 1_000,
});

export const persistOptions = {
  persister: queryPersister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: CACHE_VERSION,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) =>
      query.state.status === 'success' &&
      typeof query.queryKey[0] === 'string' &&
      PERSISTED_KEY_PREFIXES.has(query.queryKey[0]),
  },
};
