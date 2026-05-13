/**
 * Image upload helpers for the templates editor.
 *
 * The Worker's `/v1/admin/uploads` endpoint accepts a file + folder
 * and returns `{ key, url }`. Templates need a richer return — the
 * `MediaRef` JSONB column expects `{ r2Key, width, height, blurhash,
 * cdnUrl? }` — so we measure the image client-side before persisting
 * it on the template row.
 *
 * Why client-side measurement?
 *   - The Worker bucket isn't doing any image processing today (no
 *     `wrangler-images` binding wired), so dimensions would otherwise
 *     come from the admin form anyway.
 *   - Loading the image in a hidden `<img>` is free and gives us
 *     intrinsic dimensions immediately, which we need for the mobile
 *     layout (aspect-ratio constraints in the card / detail components).
 */

import type { MediaRef } from '@clickfy/types';

import { apiFetch, ApiError, type TokenGetter } from '@/lib/api';

export const ACCEPTED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export interface UploadResult extends MediaRef {
  /** Original file name — surfaced in the admin UI for clarity. */
  fileName: string;
}

interface UploadFolders {
  /** Cover / preview / gallery / reference all live under `templates/`. */
  templates: 'templates';
  /** Category icons. Mirrored from the categories form. */
  categories: 'categories';
}

/**
 * Measure intrinsic dimensions of an image File by loading it into a
 * disposable `<img>` element. Resolves with `{ width, height }` once
 * the browser has parsed the file. Falls back to 0/0 only if decoding
 * fails (callers should treat that as a hard error and surface a toast).
 */
export function measureImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image. Try a different file.'));
    };
    img.src = url;
  });
}

/**
 * Validate, measure, upload to R2 (via the Worker), and return a
 * `MediaRef`-shaped payload ready to drop into `coverMedia`,
 * `gallery[]`, or `references[].r2Key`.
 *
 * Throws `ApiError` on the upload call so callers can show a toast.
 * Validation failures throw plain `Error`s with user-friendly text.
 */
export async function uploadImageAsset(
  file: File,
  folder: keyof UploadFolders,
  getToken: TokenGetter,
): Promise<UploadResult> {
  if (!ACCEPTED_IMAGE_MIME.includes(file.type as (typeof ACCEPTED_IMAGE_MIME)[number])) {
    throw new Error('Image must be JPG, PNG, or WebP.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Image must be under ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`);
  }

  const { width, height } = await measureImage(file);
  if (!width || !height) {
    throw new Error('Could not read image dimensions.');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);

  // The Worker route returns `{ url, key }` — we lift those into a
  // `MediaRef`. `blurhash` is intentionally left empty: encoding it
  // browser-side adds ~100kb of WASM and the placeholder is purely a
  // mobile nicety we can backfill in a later batch job if we want.
  const result = await apiFetch<{ url: string; key: string }>(
    '/v1/admin/uploads',
    { method: 'POST', getToken, formData },
  );

  return {
    r2Key: result.key,
    cdnUrl: result.url,
    width,
    height,
    blurhash: '',
    fileName: file.name,
  };
}

/**
 * Re-export `ApiError` so callers don't need a second import just to
 * type-narrow upload errors.
 */
export { ApiError };
