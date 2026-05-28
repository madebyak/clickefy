/**
 * Maps a home-section key to the catalog query that lists every
 * template belonging to that section, plus a display title.
 *
 * The home screen renders sections from `GET /v1/catalog/sections`
 * (which returns a slice of `LIMIT 8` per rail). When the user taps
 * "See all", we route to `/section/[key]` which uses this same mapping
 * to load the FULL paginated list via `GET /v1/catalog/templates`
 * with the appropriate filters.
 *
 * Why this is a config object, not server-side:
 *
 *   - The server already builds composite sections (`section-builder.ts`)
 *     and exposes the underlying single-filter list endpoint with rich
 *     filtering. Adding a third "list one section paginated" endpoint
 *     would duplicate the same WHERE/ORDER plumbing for no gain.
 *
 *   - Each section is, by construction, expressible as filters on the
 *     existing list endpoint. This file is the proof.
 *
 *   - Keeping the mapping client-side means the home rail spec and the
 *     "See all" page agree by construction — they share this module.
 *
 * For per-category rails (key = `category-<uuid>`) we parse the uuid
 * out of the key and pass it as `categoryId`. The title is forwarded
 * by the home screen via the route param so we don't need a network
 * round-trip just to render a header.
 */

import type { CatalogTemplateListOptions } from '@clickfy/sdk';

export interface SectionSpec {
  /** Filters fed to `sdk.catalog.listTemplates`. */
  filters: CatalogTemplateListOptions;
  /** Default title used when the route doesn't pass one explicitly. */
  fallbackTitle: string;
}

const CATEGORY_KEY_PREFIX = 'category-';

export function isCategorySectionKey(key: string): boolean {
  return key.startsWith(CATEGORY_KEY_PREFIX);
}

export function categoryIdFromKey(key: string): string | null {
  if (!isCategorySectionKey(key)) return null;
  const id = key.slice(CATEGORY_KEY_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * Resolve a section key to its filter spec. Returns null if the key
 * is unknown — the caller should treat that as a 404.
 */
export function resolveSectionSpec(key: string): SectionSpec | null {
  switch (key) {
    case 'trending':
      return {
        // Same WHERE as `section-builder.ts`'s trending rail. We ask
        // for the curated default order so admin sortOrder still wins.
        filters: { featured: true },
        fallbackTitle: 'Trending Now',
      };
    case 'new-arrivals':
      return {
        filters: { sort: 'recent' },
        fallbackTitle: 'New Arrivals',
      };
    case 'video-magic':
      return {
        filters: { kind: 'video', sort: 'recent' },
        fallbackTitle: 'Video Magic',
      };
    case 'photo-sets':
      return {
        filters: { kind: 'image_set', sort: 'recent' },
        fallbackTitle: 'Photo Sets',
      };
    default: {
      // Per-category rail: the key carries the category UUID.
      const catId = categoryIdFromKey(key);
      if (catId) {
        return {
          filters: { categoryId: catId },
          fallbackTitle: 'Category',
        };
      }
      return null;
    }
  }
}
