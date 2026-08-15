import "server-only";

/**
 * Server-side `GET /v1/users/me`.
 *
 * Deliberately NOT routed through the `@clickfy/sdk` singleton in
 * `lib/api.ts`: that client holds its Clerk token getter in module scope,
 * set once by a browser effect. Module scope on the server is shared
 * across concurrent requests from different users, so pointing it at a
 * per-request token would risk serving one user's row to another. Here
 * the token is an explicit argument and nothing is retained between
 * calls.
 *
 * The response shape is kept byte-identical to `sdk.user.getMe()` (the
 * envelope's `data` field) because both populate the SAME React Query
 * cache entry — the server prefetches it, the browser reads and later
 * refetches it.
 */

import type { MeResponse } from "@clickfy/types";
import { config } from "@/lib/config";

/**
 * Fetch the caller's user row. Returns `null` instead of throwing on any
 * failure — this runs during a page render whose job is to show the app,
 * not to be a health check. A null result simply means the client falls
 * back to its normal fetch-on-mount, which is exactly today's behavior.
 */
export async function fetchMe(token: string | null): Promise<MeResponse | null> {
  if (!token) return null;

  try {
    const res = await fetch(`${config.apiUrl}/v1/users/me`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      // Per-user data behind a bearer token: it must never land in a
      // shared server-side cache.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: MeResponse };
    return json.data ?? null;
  } catch {
    return null;
  }
}
