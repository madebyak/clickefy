/**
 * Web app runtime config. Mirrors `apps/mobile/lib/config.ts`: one
 * dependency-free module the SDK singleton can read at import time.
 *
 * `NEXT_PUBLIC_*` vars are inlined into the browser bundle at build
 * time, so this works identically on the server and in the client.
 */

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:8787" : null);

if (!apiUrl) {
  // Fail loudly at boot rather than letting every request 404 against
  // a relative URL — same contract as the mobile app.
  throw new Error("NEXT_PUBLIC_API_URL is not set");
}

export const config = {
  /** Base URL of the Clickefy Worker API (no trailing slash). */
  apiUrl,
} as const;
