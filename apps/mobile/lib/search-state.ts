/**
 * Tiny module-scoped store for the mobile search feature.
 *
 * Why this exists: the search screen (`app/search.tsx`) and the filter
 * sheet (`app/search-filters.tsx`) live on different Expo Router
 * routes — the sheet is presented as a native iOS modal — so they
 * cannot share `useState`. URL params don't work either, because the
 * filter modal is its own route with its own params. Two options
 * remained:
 *
 *   1. Pull in `zustand` (or similar). Useful, but a fresh dep just
 *      for two screens is overkill.
 *   2. A 30-line external store backed by `useSyncExternalStore` —
 *      the React-supported, concurrent-safe way to subscribe to
 *      external state. That's this file.
 *
 * Surface intentionally small:
 *   - `useSearchFilters()` — read live state
 *   - `setSearchFilters(patch)` — merge update
 *   - `resetSearchFilters()` — Apply defaults (used by "Reset" button)
 */

import { useSyncExternalStore } from 'react';

export type TemplateKindFilter = 'image' | 'video' | 'image_set';
export type TemplateSortFilter = 'default' | 'recent';

export interface SearchFilters {
  /**
   * Single kind selection. Multi-select would need server-side
   * `kind in (...)` support; we deliberately stay 1:1 with the API
   * to keep the contract simple.
   */
  kind?: TemplateKindFilter;
  /** Restrict to featured templates. */
  featured?: boolean;
  /** Newest published first vs. curated default. */
  sort: TemplateSortFilter;
  /**
   * Active category scope. Set by the home tab's category chip when
   * the user opens search from a non-"all" surface (Etsy / App Store
   * pattern). The `/search` route shows a removable "In <label> ✕"
   * chip that clears this back to a global search. The label is held
   * separately because `categoryId` alone is opaque — we don't want
   * `/search` to do an extra fetch just to render the chip text.
   */
  categoryId?: string;
  categoryLabel?: string;
}

const DEFAULT_FILTERS: SearchFilters = {
  sort: 'default',
};

let state: SearchFilters = { ...DEFAULT_FILTERS };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return state;
}

/** React hook — subscribes to filter changes via `useSyncExternalStore`. */
export function useSearchFilters(): SearchFilters {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Merge-update the filter state. Only keys present in `patch` are
 * touched; pass `undefined` to clear a field.
 */
export function setSearchFilters(patch: Partial<SearchFilters>): void {
  state = { ...state, ...patch };
  emit();
}

/** Restore default state. Used by the sheet's "Reset" affordance. */
export function resetSearchFilters(): void {
  state = { ...DEFAULT_FILTERS };
  emit();
}

/**
 * Imperative read for non-component callers (effects on cold-start,
 * analytics). Components should always use the hook so they re-render.
 */
export function getSearchFilters(): SearchFilters {
  return state;
}

/**
 * Count of *user-applied* filters (excluding defaults). Drives the
 * "filter dot" on the filter button. We count `sort` only when it
 * differs from the default to keep the badge honest.
 */
export function countActiveFilters(f: SearchFilters): number {
  let n = 0;
  if (f.kind) n += 1;
  if (f.featured) n += 1;
  if (f.sort !== DEFAULT_FILTERS.sort) n += 1;
  if (f.categoryId) n += 1;
  return n;
}
