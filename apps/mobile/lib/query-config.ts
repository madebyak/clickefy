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
