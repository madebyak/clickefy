/**
 * Auth gate — single source of truth for "where should the user be right now".
 *
 * Drives route protection in `(tabs)/_layout.tsx` and `(auth)/_layout.tsx`.
 * Returns:
 *   - `isReady` — false until Clerk + AsyncStorage have hydrated. Children gate render on this.
 *   - `hasOnboarded` — the user has tapped through onboarding at least once.
 *   - `isAuthed` — there is an active Clerk session.
 *   - `markOnboardingComplete()` — to call from the last onboarding screen.
 *   - `resetOnboarding()` — dev helper to replay the onboarding screens.
 */

import { useAuth } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY_ONBOARDED = 'clickefy:onboarded';

export function useAuthGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const v = await AsyncStorage.getItem(KEY_ONBOARDED);
        if (!cancelled) setHasOnboarded(v === '1');
      } catch {
        if (!cancelled) setHasOnboarded(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markOnboardingComplete = useCallback(async () => {
    setHasOnboarded(true);
    await AsyncStorage.setItem(KEY_ONBOARDED, '1').catch(() => {});
  }, []);

  /** Test hook — useful for QA / debugging. Not exposed in production UI. */
  const resetOnboarding = useCallback(async () => {
    setHasOnboarded(false);
    await AsyncStorage.removeItem(KEY_ONBOARDED).catch(() => {});
  }, []);

  const isReady = hasOnboarded !== null && isLoaded;

  return {
    isReady,
    hasOnboarded: hasOnboarded ?? false,
    isAuthed: !!isSignedIn,
    markOnboardingComplete,
    resetOnboarding,
  };
}
