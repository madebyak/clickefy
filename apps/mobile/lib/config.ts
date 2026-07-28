/**
 * Mobile-app config — values resolved at build time from `app.json` → `extra`.
 *
 * Keep this module dependency-free (no React imports) so it can be read from
 * anywhere — including the SDK accessor at module scope.
 *
 * To add a new field:
 *   1. Add it under `expo.extra` in `app.json`
 *   2. Add a typed getter below
 *   3. Reference it via `config.fieldName` (do NOT use `Constants.expoConfig.extra` directly)
 */

import Constants from 'expo-constants';

type Extra = {
  /** When true, the mock SDK accepts any 6-digit OTP and tells the UI to surface a "demo build" hint. */
  demoMode?: boolean;
};

const extra: Extra = (Constants.expoConfig?.extra ?? {}) as Extra;

// EXPO_PUBLIC_* vars are inlined into process.env at build time. The
// API URL is REQUIRED — there is intentionally no production fallback,
// because a build with no URL would silently point at localhost and
// look broken to a reviewer. In `expo start` (dev only) we fall back
// to loopback so simulators work out of the box.
const envApiUrl = process.env.EXPO_PUBLIC_API_URL;
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
const resolvedApiUrl = envApiUrl ?? (isDev ? 'http://localhost:8787' : null);
if (!resolvedApiUrl) {
  // Crash loudly at startup rather than during the first network call.
  throw new Error(
    '[clickfy] EXPO_PUBLIC_API_URL is not set. Production builds must ' +
      'provide an API URL via `eas env:create production ...` (or `.env`).',
  );
}

export const config = {
  /**
   * `true` when running a demo/preview build aimed at clients — auth flows
   * become permissive so a reviewer can walk the app without a real inbox.
   * Always `false` in production builds intended for end users.
   */
  demoMode: extra.demoMode ?? false,
  apiUrl: resolvedApiUrl,
  /**
   * Public marketing/web domain. Single source of truth for any
   * user-facing link the app builds (e.g. shareable template URLs).
   * Note the spelling: the brand domain is `clickefy.ai` (with the "e").
   */
  webUrl: 'https://clickefy.ai',
  /**
   * RevenueCat public SDK keys (`appl_…` for iOS, `goog_…` for Android).
   * These are the *public* half — safe to ship in the JS bundle — so they
   * live in EAS env like the other `EXPO_PUBLIC_*` values. `null` until the
   * store is set up: when a key is null the app skips RevenueCat
   * configuration entirely and the paywall shows an "unavailable" state
   * instead of crashing, so builds work before the store goes live.
   */
  revenueCat: {
    iosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? null,
    androidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? null,
  },
} as const;

/** True for `__DEV__` (Metro/Expo Go) OR an explicit demo build. */
export function isDemoEnvironment(): boolean {
  return (typeof __DEV__ !== 'undefined' && __DEV__) || config.demoMode;
}
