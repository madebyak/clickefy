/**
 * `useRefreshOnFocus` — refetch a React-Query when the screen regains
 * focus, *skipping the very first mount* so we don't double-fetch on
 * top of React-Query's own initial fetch.
 *
 * This mirrors the pattern documented by TanStack Query for React
 * Native (which has no `window.focus` event the way the web does):
 *   https://tanstack.com/query/latest/docs/framework/react/react-native#refresh-on-screen-focus
 *
 * Pair this with `<RefreshControl />` on the screen's scroll view
 * for explicit pull-to-refresh, and you get the full "Instagram
 * feed" refresh model:
 *   • silent revalidation when the user tabs back in
 *   • explicit refetch with a spinner when they pull down
 *   • staleTime still gates extra background fetches inside that
 *     freshness window, so rapid tab-flicks don't hammer the API
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

export function useRefreshOnFocus<T>(refetch: () => Promise<T> | T): void {
  const firstTimeRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstTimeRef.current) {
        // React-Query already fetched on mount; calling refetch
        // here would just trigger an immediate redundant request.
        firstTimeRef.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );
}
