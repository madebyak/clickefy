/**
 * Centralized React Query cache configuration.
 *
 * Tiered staleTime values based on data volatility:
 *   - Static data (categories, template details) stays fresh longer
 *   - Dynamic data (user profile, credits) refreshes more aggressively
 *   - Feed data (home sections, library) sits in between
 */

/** Categories rarely change — keep fresh for 5 minutes. */
export const CATEGORIES_QUERY = {
  staleTime: 5 * 60_000,
} as const;

/** Template detail pages are mostly static content. */
export const TEMPLATE_QUERY = {
  staleTime: 5 * 60_000,
} as const;

/** Home feed sections — moderate freshness for discovery. */
export const HOME_SECTIONS_QUERY = {
  staleTime: 2 * 60_000,
} as const;

/** User's own library/saved items. */
export const LIBRARY_QUERY = {
  staleTime: 60_000,
} as const;

/** User's projects list. */
export const PROJECTS_QUERY = {
  staleTime: 60_000,
} as const;

/** User profile / credits — needs frequent refreshes after purchases. */
export const USER_ME_QUERY = {
  staleTime: 30_000,
  retry: 1,
} as const;

/**
 * Search results.
 *
 * Tuned for the iOS-style "search-as-you-type" pattern where each
 * keystroke (post-debounce) becomes its own cache entry keyed by the
 * exact query + filter combo. We keep results fresh for 30s — long
 * enough that bouncing back to a recently-typed query feels instant,
 * short enough that a freshly-published template appears within a
 * realistic window. `gcTime` is deliberately small (60s) so the
 * cache doesn't grow unbounded as the user types.
 */
export const SEARCH_QUERY = {
  staleTime: 30_000,
  gcTime: 60_000,
} as const;
