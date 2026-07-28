/**
 * `usePushRegistration` — single-mount hook that handles the push
 * notification lifecycle for the whole app. Mount it once near the
 * root of the tree; never call it from a screen.
 *
 * Why one mount and not per-screen:
 *   • Expo's docs are explicit that `addPushTokenListener` should be
 *     installed once at the top of the tree
 *     (https://docs.expo.dev/versions/latest/sdk/notifications/#addpushtokenlistenerlistener).
 *     Multiple subscriptions don't dedupe — every mount fires its own
 *     handler when the OS rotates a token.
 *   • Clerk's `getToken` reference is unstable across renders
 *     (clerk/javascript#201). If we listed it as a dependency, the
 *     effect would tear down + resubscribe on every re-render of the
 *     hosting tree. We capture it in a ref instead so the closure
 *     always reads the freshest `getToken` without re-running.
 *
 * Behaviour:
 *   1. On `isSignedIn` becoming truthy: ask permission, fetch the
 *      Expo token, POST it to the backend.
 *   2. Subscribe to OS-driven token rotation events for the lifetime
 *      of the signed-in session.
 *   3. On sign-out / unmount: tear down the subscription so a
 *      subsequent sign-in starts clean.
 */

import { useAuth } from '@clerk/expo';
import { useEffect, useRef } from 'react';

import {
  registerForPushNotificationsAsync,
  subscribeToTokenRotation,
} from './push-notifications';

export function usePushRegistration(): void {
  const { isSignedIn, userId, getToken } = useAuth();

  // `getToken` identity from `useAuth()` is not stable across renders
  // (clerk/javascript#201). Storing it in a ref means the listener
  // closure always reads the latest implementation without forcing
  // an effect re-run, which is exactly what we want.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isSignedIn || !userId) return;

    // Initial register. `registerForPushNotificationsAsync` is
    // idempotent and short-circuits if the token hasn't changed
    // since the last successful POST, so a sign-out → sign-in
    // round-trip still does the right thing.
    void registerForPushNotificationsAsync(async () => getTokenRef.current()).then(
      (result) => {
        if (__DEV__) {
          if (result.token) {
            console.log('[push] registered', result.token.slice(0, 24) + '...');
          } else if (result.reason && result.reason !== 'simulator') {
            // `simulator` is the expected outcome on iOS Sim / Android
            // Emulator and not worth surfacing.
            console.log('[push] register skipped:', result.reason);
          }
        }
      },
    );

    const rotationSub = subscribeToTokenRotation(async () =>
      getTokenRef.current(),
    );
    return () => {
      rotationSub.remove();
    };
    // Intentionally only depending on the user identity. Re-subscribing
    // on `getToken` changes is what caused the original storm, and
    // the ref above keeps the closure correct without that dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userId]);
}
