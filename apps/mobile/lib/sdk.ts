/**
 * SDK accessor — returns a singleton client.
 *
 * As of Phase C, the SDK is fully HTTP-backed — there is no mock
 * client and no fixture data. Every method calls into the Worker
 * API at `baseUrl`.
 *
 * Auth posture (mobile-specific):
 *   - Auth is owned by Clerk. Screens read `useAuth()` / `useSignIn()`
 *     directly; the SDK only needs a token getter so authenticated
 *     fetches carry `Authorization: Bearer <jwt>`.
 *   - `attachTokenGetter()` is wired by `<SdkBridge />` in
 *     `_layout.tsx` once Clerk's hooks are mounted.
 *
 * Token injection: `getSDK()` is module-scoped (no React context),
 * so we read the token via a lazily-attached getter. The first
 * `getSDK()` call constructs the singleton; subsequent calls reuse
 * it. The getter is captured by reference, so a later
 * `attachTokenGetter` still updates the live SDK.
 */

import { createHttpClient, type SDKClient } from '@clickfy/sdk';

import { config } from './config';

let tokenGetter: (() => Promise<string | null>) | null = null;

/** Called from React tree once Clerk's `useAuth` is available. */
export function attachTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter;
}

let cached: SDKClient | null = null;

export function getSDK(): SDKClient {
  if (cached) return cached;

  cached = createHttpClient({
    baseUrl: config.apiUrl,
    getToken: async () => (tokenGetter ? tokenGetter() : null),
  });

  return cached;
}
