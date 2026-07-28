/**
 * SDK singleton + Clerk token bridge — the web port of
 * `apps/mobile/lib/sdk.ts`.
 *
 * The SDK is constructed once, lazily, with a `getToken` that reads a
 * module-scoped getter. `ClerkSdkBridge` (in `components/providers.tsx`)
 * attaches Clerk's `getToken` after hydration; until then authed calls
 * simply send no token (the studio is auth-gated, so in practice the
 * bridge mounts before any query fires).
 */

import { createHttpClient, type SDKClient } from "@clickfy/sdk";
import { config } from "@/lib/config";

type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;
let localeGetter: (() => string) | null = null;
let client: SDKClient | null = null;

/** Wire Clerk's `getToken` into the SDK. Safe to call repeatedly. */
export function attachTokenGetter(getter: TokenGetter) {
  tokenGetter = getter;
}

/** Wire the active locale so catalog reads come back translated. */
export function attachLocaleGetter(getter: () => string) {
  localeGetter = getter;
}

export function getSDK(): SDKClient {
  if (!client) {
    client = createHttpClient({
      baseUrl: config.apiUrl,
      getToken: async () => (tokenGetter ? tokenGetter() : null),
      getLocale: () => (localeGetter ? localeGetter() : "en"),
    });
  }
  return client;
}
