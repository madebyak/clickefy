/**
 * Mobile-app config — build-time values (`EXPO_PUBLIC_*` env vars, inlined
 * by Expo) plus fixed constants. Read it via `config.fieldName`.
 *
 * Keep this module dependency-free (no React imports) so it can be read from
 * anywhere — including the SDK accessor at module scope.
 */

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
