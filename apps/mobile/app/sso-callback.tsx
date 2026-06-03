/**
 * SSO callback — deep-link safety net for browser-based OAuth.
 *
 * Why this route exists:
 *   On Android standalone builds, `WebBrowser.openAuthSessionAsync` (used
 *   internally by Clerk's `useSSO().startSSOFlow`) often fails to *capture*
 *   the `clickfy://sso-callback?...` redirect. Instead Android delivers the
 *   URL to the app's deep-link handler (Expo Router). Without a matching
 *   route the user sees "Unmatched Route" even though Clerk already created
 *   the session (the leaked URL carries `created_session_id=...`). This is the
 *   long-standing expo-auth-session "returns dismiss on Android" behavior
 *   (expo/expo#23781).
 *
 * What it does:
 *   Reads the OAuth result straight from the deep-link params and finalizes
 *   the session itself — mirroring the exact steps `useSSO` performs after a
 *   successful browser capture:
 *     1. `created_session_id` present  → returning user: activate it.
 *     2. only `rotating_token_nonce`   → reload the sign-in; if Clerk marks it
 *        `transferable` (first-time OAuth user) transfer it into a sign-up,
 *        then activate whichever session id we end up with.
 *   On anything unexpected we route back to welcome rather than dead-end.
 *
 * This is purely additive: when `startSSOFlow` DOES capture the redirect
 * (iOS, dev builds) this screen is never reached.
 */

import { useSignIn, useSignUp } from '@clerk/expo/legacy';
import { useTheme } from '@clickfy/ui';
import * as Sentry from '@sentry/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';

export default function SSOCallbackScreen() {
  const { colors, accent } = useTheme();
  const router = useRouter();
  const { signIn, setActive, isLoaded: signInLoaded } = useSignIn();
  const { signUp, isLoaded: signUpLoaded } = useSignUp();
  const params = useLocalSearchParams<Record<string, string>>();

  // The deep link can re-fire (e.g. config-change remount); only run once.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    if (!signInLoaded || !signUpLoaded || !signIn || !signUp) return;
    handled.current = true;

    const createdSessionId =
      typeof params.created_session_id === 'string' ? params.created_session_id : null;
    const nonce =
      typeof params.rotating_token_nonce === 'string' ? params.rotating_token_nonce : null;

    void (async () => {
      try {
        // Returning user — Clerk already minted the session server-side.
        if (createdSessionId) {
          await setActive({ session: createdSessionId });
          router.replace('/(tabs)');
          return;
        }

        // First-time / transferable OAuth user — finish the handshake.
        if (nonce) {
          await signIn.reload({ rotatingTokenNonce: nonce });
          if (signIn.firstFactorVerification.status === 'transferable') {
            await signUp.create({ transfer: true });
          }
          const sessionId = signUp.createdSessionId ?? signIn.createdSessionId;
          if (sessionId) {
            await setActive({ session: sessionId });
            router.replace('/(tabs)');
            return;
          }
        }

        // Neither path yielded a session — log what we got and bail safely.
        Sentry.captureMessage('[sso-callback] deep link without usable session', {
          level: 'warning',
          extra: {
            hasCreatedSession: !!createdSessionId,
            hasNonce: !!nonce,
            signInStatus: signIn.status ?? null,
            firstFactorStatus: signIn.firstFactorVerification?.status ?? null,
          },
        });
        router.replace('/(auth)/welcome');
      } catch (err) {
        Sentry.captureException(err, { extra: { where: 'sso-callback' } });
        router.replace('/(auth)/welcome');
      }
    })();
  }, [params, router, setActive, signIn, signInLoaded, signUp, signUpLoaded]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ActivityIndicator color={accent.solid} />
    </View>
  );
}
