/**
 * Client-side wrappers for `/v1/admin/banners`.
 *
 * Mirrors the response shapes returned by `apps/api/src/routes/admin-banners.ts`.
 * The full row type lives in `@clickfy/types` (`HomeBanner`) so both
 * the API and admin agree by construction; we re-export it here for
 * import ergonomics in the dashboard.
 */

import type { HomeBanner, HomeBannerCta, HomeBannerKind } from '@clickfy/types';

import { apiFetch, type TokenGetter } from '@/lib/api';

export type { HomeBanner, HomeBannerCta, HomeBannerKind };

/** Body shape for `POST /v1/admin/banners`. */
export interface CreateBannerInput {
  kind: HomeBannerKind;
  media: Array<{
    r2Key: string;
    width: number;
    height: number;
    blurhash: string;
    cdnUrl?: string;
  }>;
  title?: string | null;
  subtitle?: string | null;
  cta?: HomeBannerCta;
  sortOrder?: number;
  isActive?: boolean;
  /** ISO 8601. Pass `null` to clear an existing schedule bound. */
  startsAt?: string | null;
  endsAt?: string | null;
}

/** Body shape for `PATCH /v1/admin/banners/:id`. Any subset. */
export type UpdateBannerInput = Partial<CreateBannerInput>;

export function fetchBanners(getToken: TokenGetter) {
  return apiFetch<HomeBanner[]>('/v1/admin/banners', { getToken });
}

export function createBanner(input: CreateBannerInput, getToken: TokenGetter) {
  return apiFetch<HomeBanner>('/v1/admin/banners', {
    method: 'POST',
    getToken,
    json: input,
  });
}

export function updateBanner(
  id: string,
  input: UpdateBannerInput,
  getToken: TokenGetter,
) {
  return apiFetch<HomeBanner>(`/v1/admin/banners/${id}`, {
    method: 'PATCH',
    getToken,
    json: input,
  });
}

export function deleteBanner(id: string, getToken: TokenGetter) {
  return apiFetch<void>(`/v1/admin/banners/${id}`, {
    method: 'DELETE',
    getToken,
  });
}

/**
 * Bulk reorder. Pass the desired final order of banner ids; the
 * server assigns `sortOrder = arrayIndex` to each one in a single
 * call. Refuses if any id is unknown (no partial reorders).
 */
export function reorderBanners(ids: string[], getToken: TokenGetter) {
  return apiFetch<HomeBanner[]>('/v1/admin/banners/reorder', {
    method: 'POST',
    getToken,
    json: { ids },
  });
}
