/**
 * Typed client for the Cloudflare Worker API.
 *
 * Browser-side only — we use Clerk's `useAuth().getToken()` to mint a short-
 * lived JWT and forward it as a Bearer token. Server-side admin code (server
 * actions, route handlers) should `import { auth } from '@clerk/nextjs/server'`
 * and call `auth().getToken()` instead; that path isn't wired yet because we
 * stick to client-side fetches in the zustand stores.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error(
    'NEXT_PUBLIC_API_URL is not set. Add it to apps/admin/.env.local.',
  );
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type TokenGetter = () => Promise<string | null>;

export interface ApiFetchInit extends Omit<RequestInit, 'body'> {
  /** Plain JSON body — will be stringified + content-type set. */
  json?: unknown;
  /** Raw FormData for file uploads. Takes precedence over `json`. */
  formData?: FormData;
}

/**
 * Issues an authenticated request and unwraps `{ data }` / `{ error }`.
 * Throws `ApiError` on non-2xx responses so callers can show toasts.
 */
export async function apiFetch<T>(
  path: string,
  init: ApiFetchInit & { getToken?: TokenGetter } = {},
): Promise<T> {
  const { json, formData, getToken, headers, ...rest } = init;

  const finalHeaders = new Headers(headers);
  if (getToken) {
    const token = await getToken();
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  }

  let body: BodyInit | undefined;
  if (formData) {
    body = formData;
  } else if (json !== undefined) {
    body = JSON.stringify(json);
    finalHeaders.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
    body,
  });

  // 204 No Content
  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // empty body
  }

  if (!res.ok) {
    const errPayload = payload as { error?: { code?: string; message?: string } } | null;
    const err = errPayload?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'unknown_error',
      err?.message ?? `Request failed with status ${res.status}`,
    );
  }

  const ok = payload as { data?: T } | null;
  return (ok?.data ?? (payload as T));
}
