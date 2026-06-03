/**
 * useNotificationPrefs — toggle the user's notification preferences with
 * instant UI feedback and a debounced server write.
 *
 * Why: the settings screen previously fired a `PATCH /v1/users/me` on
 * every switch tap. Flicking a few toggles quickly tripped the API rate
 * limiter (429s in Sentry). This hook mirrors `useAppearance`:
 *   1. Optimistically patches the cached `/me` row so the <Switch />
 *      flips immediately (no perceived lag).
 *   2. Accumulates the changed keys and flushes a SINGLE PATCH after a
 *      short debounce, so rapid toggling collapses into one request.
 */

import { useQueryClient } from '@tanstack/react-query';
import {
  withPreferenceDefaults,
  type MeResponse,
  type UserPreferences,
} from '@clickfy/types';
import { useCallback, useEffect, useRef } from 'react';

import { ME_QUERY_KEY, useSession } from './use-session';

const SERVER_SYNC_DEBOUNCE_MS = 500;

type NotificationKey = keyof UserPreferences['notifications'];

export function useNotificationPrefs() {
  const queryClient = useQueryClient();
  const { isAuthed, preferences, updateProfile } = useSession();

  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Partial<UserPreferences['notifications']>>({});

  useEffect(() => {
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, []);

  const setNotification = useCallback(
    (key: NotificationKey, value: boolean) => {
      // 1. Optimistic cache write → the Switch reflects the new value now.
      const previous = queryClient.getQueryData<MeResponse>(ME_QUERY_KEY);
      if (previous) {
        const safe = withPreferenceDefaults(previous.preferences);
        queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, {
          ...previous,
          preferences: {
            ...safe,
            notifications: { ...safe.notifications, [key]: value },
          },
        });
      }

      if (!isAuthed) return;

      // 2. Accumulate + debounce a single server PATCH.
      pending.current[key] = value;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => {
        const changes = pending.current;
        pending.current = {};
        void updateProfile.mutateAsync({
          preferences: { notifications: changes },
        });
      }, SERVER_SYNC_DEBOUNCE_MS);
    },
    [isAuthed, queryClient, updateProfile],
  );

  return {
    notifications: preferences.notifications,
    setNotification,
  };
}
