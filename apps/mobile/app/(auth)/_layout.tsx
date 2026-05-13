import { Redirect, Stack } from 'expo-router';

import { useAuthGate } from '@/lib/auth-gate';

/**
 * Auth group — onboarding, sign-in, paywall.
 *
 * Routing rule: if the user has an active Clerk session, they belong in
 * `/(tabs)`, period — onboarding is a first-time-visitor primer, not a
 * gate, and rendering sign-in/up screens while authed produces confusing
 * "you're already signed in" errors when the screens call `signIn.create`.
 */
export default function AuthLayout() {
  const { isReady, isAuthed } = useAuthGate();
  if (!isReady) return null;
  if (isAuthed) return <Redirect href="/(tabs)" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        gestureEnabled: false,
      }}
    >
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="sign-in" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="sign-up" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="verify" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="paywall" options={{ animation: 'slide_from_bottom' }} />
    </Stack>
  );
}
