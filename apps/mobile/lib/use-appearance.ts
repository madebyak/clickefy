/**
 * useAppearance — single source of truth for theme/accent in the mobile
 * app, with server-side sync.
 *
 * Why this layer exists:
 *   - `@clickfy/ui`'s `ThemeProvider` persists theme prefs to
 *     AsyncStorage only — that gives instant pre-auth responsiveness but
 *     doesn't follow a user across devices.
 *   - The signed-in user's `preferences.appearance` lives on our API.
 *
 * Behaviour:
 *   1. On signed-in hydration, push server prefs INTO the local
 *      ThemeProvider (one-shot, only if they differ). This makes a
 *      second-device sign-in adopt the user's saved mode/accent.
 *   2. On any change made through `setMode` / `setAccent`, update the
 *      local provider immediately (fast UX) and debounce a PATCH to
 *      `/v1/users/me` so we don't hammer the API when the user mashes
 *      through accent swatches.
 *
 * Pre-auth screens can still call `useTheme()` directly — they just won't
 * trigger server writes. Authenticated screens should prefer this hook.
 */

import { useTheme, type AccentKey } from '@clickfy/ui';
import type { ThemeMode } from '@clickfy/types';
import { useCallback, useEffect, useRef } from 'react';

import { useSession } from './use-session';

const SERVER_SYNC_DEBOUNCE_MS = 500;

export function useAppearance() {
  const theme = useTheme();
  const { isAuthed, preferences, updateProfile, meQuery } = useSession();

  const serverApplied = useRef(false);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Server → Local (one-shot on first authed hydration) ───────────
  useEffect(() => {
    if (!isAuthed) {
      // Reset so a sign-out → sign-in re-applies the new account's prefs.
      serverApplied.current = false;
      return;
    }
    if (serverApplied.current) return;
    if (!meQuery.data) return;

    const serverMode = preferences.appearance.mode;
    const serverAccent = preferences.appearance.accent;

    if (serverMode !== theme.mode) {
      theme.setMode(serverMode);
    }
    if (serverAccent !== theme.accentKey) {
      theme.setAccent(serverAccent);
    }

    serverApplied.current = true;
    // We deliberately depend on meQuery.data so the effect fires once
    // after the /me query lands, not on every theme change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, meQuery.data]);

  // ── Debounced server writer ───────────────────────────────────────
  const scheduleServerSync = useCallback(
    (next: { mode?: ThemeMode; accent?: AccentKey }) => {
      if (!isAuthed) return;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => {
        void updateProfile.mutateAsync({
          preferences: { appearance: next },
        });
      }, SERVER_SYNC_DEBOUNCE_MS);
    },
    [isAuthed, updateProfile],
  );

  useEffect(() => {
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, []);

  // ── Public setters ────────────────────────────────────────────────
  const setMode = useCallback(
    (next: ThemeMode) => {
      theme.setMode(next);
      scheduleServerSync({ mode: next });
    },
    [theme, scheduleServerSync],
  );

  const setAccent = useCallback(
    (next: AccentKey) => {
      theme.setAccent(next);
      scheduleServerSync({ accent: next });
    },
    [theme, scheduleServerSync],
  );

  const toggleScheme = useCallback(() => {
    const target: ThemeMode = theme.scheme === 'dark' ? 'light' : 'dark';
    setMode(target);
  }, [theme.scheme, setMode]);

  return {
    mode: theme.mode,
    accentKey: theme.accentKey,
    scheme: theme.scheme,
    setMode,
    setAccent,
    toggleScheme,
  };
}
