/**
 * useLocaleSwitch — drives the in-app language switch.
 *
 * Switching between English and Arabic flips the whole app between LTR and
 * RTL, which React Native can only apply on a fresh start. So a switch is a
 * deliberate, confirmed action: we persist the choice, change the i18next
 * language, set the native RTL flags, best-effort sync the server, then
 * reload the app.
 *
 * Persistence order matters: AsyncStorage (`persistLocale`) is what the boot
 * resolver reads first, so the choice survives the reload regardless of
 * whether the server write lands. The server write is cross-device sync only.
 */

import { useCallback } from 'react';
import { Alert, I18nManager } from 'react-native';
import { reloadAppAsync } from 'expo';
import * as Updates from 'expo-updates';

import type { UserLocale } from '@clickfy/types';

import { i18n, IS_EXPO_GO, persistLocale } from './i18n';
import {
  hideLocaleSwitchOverlay,
  showLocaleSwitchOverlay,
} from './locale-switch-overlay';
import { useSession } from './use-session';

const LOCALE_LABELS: Record<UserLocale, string> = {
  en: 'English',
  ar: 'العربية',
};

// Shown on the restart overlay — phrased in the language being switched TO.
const SWITCH_MESSAGES: Record<UserLocale, string> = {
  en: 'Switching to English…',
  ar: 'جارٍ التبديل إلى العربية…',
};

export function useLocaleSwitch() {
  const { isAuthed, updateProfile } = useSession();

  // i18n.language is set at boot and only changes via this flow (which
  // reloads), so reading it synchronously is sufficient for the active state.
  const locale: UserLocale = i18n.language === 'ar' ? 'ar' : 'en';

  const applyLocale = useCallback(
    async (next: UserLocale) => {
      // 0) Cover the screen immediately so the tap feels responsive and the
      //    reload's white flash is hidden behind a branded transition.
      showLocaleSwitchOverlay(SWITCH_MESSAGES[next]);

      // 1) Persist locally FIRST — this is the source of truth the boot
      //    resolver reads, so the language sticks even if everything below
      //    is interrupted by the reload.
      await persistLocale(next);

      // 2) Switch the runtime language (covers the brief window before
      //    reload and the dev/Expo Go case where reload is a no-op).
      try {
        await i18n.changeLanguage(next);
      } catch {
        // Non-fatal: persisted choice is applied on next boot anyway.
      }

      // 3) Set native direction. These persist across restarts and take
      //    effect on the next app start.
      const rtl = next === 'ar';
      I18nManager.allowRTL(rtl);
      I18nManager.forceRTL(rtl);

      // 4) Best-effort cross-device sync (signed-in users only).
      if (isAuthed) {
        try {
          await updateProfile.mutateAsync({ locale: next });
        } catch {
          // Ignore — local persistence already guarantees correctness.
        }
      }

      // 5) Apply by reloading. The RTL/LTR flag is applied when the React
      //    surface is recreated; reloading does exactly that and is sufficient
      //    on dev builds, EAS builds, and production (RN 0.81's Fabric fix
      //    re-reads the direction on surface recreation — no manual process
      //    kill needed).
      //
      //    Expo Go is the one exception: it resets the RTL flag on every
      //    launch, so RTL simply cannot be applied there. Don't reload (it
      //    would loop / be a no-op) — tell the user to use a real build.
      if (IS_EXPO_GO) {
        hideLocaleSwitchOverlay();
        Alert.alert(
          'Use a development build',
          'The language text switched, but right-to-left layout cannot be applied in Expo Go. Run a dev build (npx expo run:ios / run:android) or an EAS build to see RTL.',
        );
        return;
      }

      // Brief dwell so the overlay is perceived as an intentional transition
      // (rather than a flicker) before the surface tears down.
      await new Promise((resolve) => setTimeout(resolve, 500));

      // `reloadAppAsync` (expo-modules-core) is the most robust auto-restart:
      // it's always present (no expo-updates config required) and performs a
      // native reload on both iOS and Android. Fall back to the expo-updates
      // reload, then to a manual-restart prompt only if both are unavailable.
      try {
        await reloadAppAsync('locale-change');
      } catch {
        try {
          await Updates.reloadAsync();
        } catch {
          hideLocaleSwitchOverlay();
          Alert.alert(
            'Almost there',
            'Please fully close and reopen the app to finish switching the language.',
          );
        }
      }
    },
    [isAuthed, updateProfile],
  );

  const chooseLocale = useCallback(
    (next: UserLocale) => {
      if (next === locale) return;
      Alert.alert(
        'Switch language?',
        `The app will restart to display in ${LOCALE_LABELS[next]}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Restart', style: 'default', onPress: () => void applyLocale(next) },
        ],
      );
    },
    [locale, applyLocale],
  );

  return { locale, chooseLocale };
}
