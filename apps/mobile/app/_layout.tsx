import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
import { GeistMono_500Medium, GeistMono_600SemiBold, GeistMono_700Bold } from '@expo-google-fonts/geist-mono';
import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import { ThemeProvider as NavThemeProvider, type Theme as NavTheme } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '@clickfy/ui';
import { useFonts } from 'expo-font';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { ErrorBoundary } from 'react-error-boundary';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorFallback } from '@/components/ErrorFallback';
import { Splash } from '@/components/Splash';
import { attachTokenGetter } from '@/lib/sdk';

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error(
    'Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Add it to apps/mobile/.env',
  );
}

void SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Silence a known iOS splash-screen quirk under the new architecture.
 *
 * When a modal screen mounts (e.g. `/template/[id]`, `/use/[id]`) iOS
 * creates a fresh `UIViewController`. Various code paths inside
 * `expo-router` and `expo-splash-screen` then call `SplashScreen.hide()`
 * as a defensive cleanup, but the modal VC has no splash registered —
 * `ExpoSplashScreen` throws:
 *
 *   "No native splash screen registered for given view controller.
 *    Call 'SplashScreen.show' for given view controller first."
 *
 * The throws inside `expo-router/build/views/Try.js` and
 * `renderRootComponent.js` aren't `.catch()`-guarded, so they bubble
 * up as an "Uncaught (in promise)" LogBox entry the user can't dismiss.
 *
 * We patch the native `hide()` to swallow that specific error. The
 * real splash is hidden once on cold-start (after fonts load) — every
 * subsequent call is a no-op anyway, so eating the throw is safe.
 *
 * If `expo-splash-screen` eventually adds proper VC tracking, drop
 * this block.
 */
type SplashNativeModule = { hide?: (...args: unknown[]) => void };
const splashNative = requireOptionalNativeModule<SplashNativeModule>('ExpoSplashScreen');
if (splashNative && typeof splashNative.hide === 'function') {
  const originalHide = splashNative.hide.bind(splashNative);
  splashNative.hide = (...args: unknown[]) => {
    try {
      return originalHide(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('No native splash screen registered')) {
        return undefined;
      }
      throw err;
    }
  };
}

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_500Medium,
    GeistMono_600SemiBold,
    GeistMono_700Bold,
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 10 * 60_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
    [],
  );

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    // Native splash stays visible thanks to preventAutoHideAsync above.
    return null;
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <SdkBridge />
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultMode="system" defaultAccentKey="violet">
              <ThemedShell>
              <ErrorBoundary FallbackComponent={ErrorFallback} onError={(err) => console.error('[ErrorBoundary]', err)}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="(auth)" options={{ headerShown: false, animation: 'fade' }} />
              <Stack.Screen
                name="template/[id]"
                options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
              />
              <Stack.Screen
                name="use/[id]"
                options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
              />
              <Stack.Screen
                name="generating"
                options={{
                  presentation: 'fullScreenModal',
                  animation: 'fade',
                  gestureEnabled: false,
                }}
              />
              <Stack.Screen
                name="result/[jobId]"
                options={{ presentation: 'fullScreenModal', animation: 'fade' }}
              />
              <Stack.Screen
                name="paywall"
                options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
              />
              <Stack.Screen
                name="edit-profile"
                options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
              />
              <Stack.Screen
                name="drawer"
                options={{
                  presentation: 'transparentModal',
                  animation: 'fade',
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
              <Stack.Screen
                name="legal/[doc]"
                options={{ presentation: 'card', animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="report"
                options={{
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                }}
              />
              <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
              </ErrorBoundary>
              </ThemedShell>
            </ThemeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ClerkProvider>
  );
}

/**
 * Hands Clerk's `getToken()` to the module-scoped SDK so authenticated
 * `fetch` calls can attach a fresh JWT. Has no UI — returns null and runs
 * an effect on mount.
 */
function SdkBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    // Clerk caches the token internally and refreshes it on demand; we
    // just hand them our adapter so the SDK reads it lazily.
    attachTokenGetter(async () => (await getToken()) ?? null);
  }, [getToken]);
  return null;
}

/**
 * Bridges our `@clickfy/ui` theme into React Navigation's theme + StatusBar.
 * Lives inside `ThemeProvider` so it can read `useTheme()`.
 */
function ThemedShell({ children }: { children: ReactNode }) {
  const t = useTheme();
  const [splashDone, setSplashDone] = useState(false);

  const navTheme = useMemo<NavTheme>(
    () => ({
      dark: t.scheme === 'dark',
      colors: {
        background: t.colors.bg,
        card: t.colors.surface,
        text: t.colors.ink,
        border: t.colors.border,
        primary: t.accent.solid,
        notification: t.accent.solid,
      },
      fonts: {
        regular: { fontFamily: t.fontFamily.sans, fontWeight: '400' },
        medium: { fontFamily: t.fontFamily.sansMedium, fontWeight: '500' },
        bold: { fontFamily: t.fontFamily.sansBold, fontWeight: '700' },
        heavy: { fontFamily: t.fontFamily.sansBold, fontWeight: '800' },
      },
    }),
    [t],
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <NavThemeProvider value={navTheme}>{children}</NavThemeProvider>
      {!splashDone ? <Splash onComplete={() => setSplashDone(true)} /> : null}
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}
