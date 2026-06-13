/**
 * i18n foundation for the mobile app.
 *
 * Stack (Expo-standard): `i18next` + `react-i18next`, with device locale
 * detection via `expo-localization` and the chosen locale persisted in
 * AsyncStorage.
 *
 * Locale resolution order (see `resolveInitialLocale`):
 *   1. Persisted choice (AsyncStorage) — survives restarts, known before
 *      sign-in so pre-auth screens (onboarding/welcome) render correctly.
 *   2. Device locale (`expo-localization`).
 *   3. `'en'` fallback.
 *
 * After sign-in, the user's server-side `users.locale` is the source of
 * truth; syncing that into here is wired up alongside the language
 * toggle (Phase 4). English is always the i18next `fallbackLng`, so a
 * missing key never renders blank.
 *
 * RTL: switching direction needs `I18nManager` + an app reload. That is
 * handled by the language toggle flow (Phase 4); this module only owns
 * string resolution and the persisted preference.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import { reloadAppAsync } from 'expo';
import * as Updates from 'expo-updates';

import type { UserLocale } from '@clickfy/types';

import { DEFAULT_NS, NAMESPACES, resources } from './resources';

/**
 * Expo Go (`storeClient`) resets the native `I18nManager` RTL flag on every
 * launch because that flag is global and would otherwise leak across every
 * project opened in Expo Go. That means RTL can NEVER be applied or tested in
 * Expo Go, and reloading after a `forceRTL` there causes an infinite reload
 * loop (flag resets → "should be RTL" is true again → reload → repeat).
 *
 * A managed dev build, EAS build, and production are all `standalone` (or
 * `bare`), where the flag persists and a reload correctly applies RTL. So we
 * gate the reload on "not Expo Go" rather than on `__DEV__` — a dev build is
 * still `__DEV__` but CAN apply RTL.
 */
export const IS_EXPO_GO =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const SUPPORTED_LOCALES = ['en', 'ar'] as const satisfies readonly UserLocale[];
export const DEFAULT_LOCALE: UserLocale = 'en';

/** AsyncStorage key for the user's explicit language choice. */
export const LOCALE_STORAGE_KEY = 'clickfy.locale';

/**
 * Coerce an arbitrary IETF/BCP-47 code (e.g. `ar-EG`, `en-US`) to one of
 * our supported locales, or `null` when unsupported.
 */
function normalizeLocale(code: string | null | undefined): UserLocale | null {
  if (!code) return null;
  const base = code.split('-')[0]?.toLowerCase();
  if (base === 'ar') return 'ar';
  if (base === 'en') return 'en';
  return null;
}

/**
 * Resolve the locale to boot with: persisted choice → device → English.
 * Never throws — storage errors fall through to the device/English path.
 */
export async function resolveInitialLocale(): Promise<UserLocale> {
  try {
    const stored = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
    const fromStore = normalizeLocale(stored);
    if (fromStore) return fromStore;
  } catch {
    // Ignore storage read failures — fall back to device/English.
  }
  const device = normalizeLocale(getLocales()[0]?.languageCode ?? null);
  return device ?? DEFAULT_LOCALE;
}

let initialized = false;

/**
 * Initialize i18next exactly once with the resolved locale. Safe to call
 * repeatedly; subsequent calls only switch the active language if the
 * resolved locale changed. Returns the locale it settled on.
 */
export async function initI18n(): Promise<UserLocale> {
  const locale = await resolveInitialLocale();
  if (!initialized) {
    await i18n.use(initReactI18next).init({
      resources,
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      ns: NAMESPACES as unknown as string[],
      defaultNS: DEFAULT_NS,
      // React already escapes output — disable i18next's HTML escaping.
      interpolation: { escapeValue: false },
      // Render missing keys as the key/fallback, never `null`.
      returnNull: false,
    });
    initialized = true;
  } else if (i18n.language !== locale) {
    await i18n.changeLanguage(locale);
  }

  await syncNativeDirection(locale);
  return locale;
}

/**
 * Align React Native's native layout direction with the resolved locale.
 *
 * `I18nManager` direction changes only take effect once the React surface is
 * recreated (a reload). So if a device whose stored/system language is Arabic
 * launches while the native flag is still LTR (e.g. first launch after the
 * choice was persisted), we set the flags and reload once so it comes up in
 * RTL. The `isRTL === shouldRTL` guard makes this a one-shot, not a loop.
 *
 * We never reload in Expo Go: the flag resets on every launch there, so a
 * reload would loop forever and RTL can't be applied regardless. On dev/EAS/
 * production builds the flag persists and the reload applies cleanly.
 */
async function syncNativeDirection(locale: UserLocale): Promise<void> {
  const shouldRTL = locale === 'ar';
  if (I18nManager.isRTL === shouldRTL) return;
  I18nManager.allowRTL(shouldRTL);
  I18nManager.forceRTL(shouldRTL);
  if (IS_EXPO_GO) return;
  try {
    await reloadAppAsync('rtl-sync');
  } catch {
    try {
      await Updates.reloadAsync();
    } catch {
      // Reload unavailable — direction applies on next launch; non-fatal.
    }
  }
}

/** Persist the user's explicit language choice. Never throws. */
export async function persistLocale(locale: UserLocale): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Best-effort; a failed write just means we re-resolve next launch.
  }
}

export { i18n };
