/**
 * Welcome — auth entry screen, shown after onboarding for unauthenticated users.
 *
 * Layout (top → bottom, full-bleed):
 *   1. Hero    — full FloatingDeck orbit composition (our own assets, big &
 *                tilted, with Ken-Burns drift) instead of a stock product photo.
 *                A soft vertical gradient fades the hero into the page so the
 *                wordmark sits cleanly on `colors.bg`.
 *   2. Brand   — official SVG Logo (theme-aware) + serif tagline.
 *   3. Auth    — three sign-in paths: Apple, Google, Email. Apple/Google are
 *                instant mock auth → paywall; Email routes to the OTP flow.
 *   4. Footer  — Terms of Service / Privacy Policy fine print.
 *
 * Everything below the hero fades + rises on mount (250 ms each, staggered)
 * so the screen feels designed, not stamped together. Reduce Motion users get
 * a single fade. Apple/Google handlers stay one-line; swapping the mock SDK
 * for real OAuth (Clerk / @react-native-google-signin) will not change the UI.
 */

import { useSSO } from '@clerk/expo';
import { isClerkAPIResponseError } from '@clerk/react/errors';
import { Box, Button, Stack, Text, useTheme } from '@clickfy/ui';
import * as AuthSession from 'expo-auth-session';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoogleG } from '@/components/auth/GoogleG';
import { Logo } from '@/components/brand/Logo';
import { FloatingDeck } from '@/components/onboarding/FloatingDeck';
import { slide1Images } from '@/components/onboarding/images';
import { Icon } from '@/components/ui/Icon';

// Required by `useSSO()` — finishes any auth session that was running when the
// browser closed (e.g., user backgrounded the app mid-flow). Idempotent and
// safe to call at module scope per Expo's docs.
WebBrowser.maybeCompleteAuthSession();

/** Discriminator for the loading-state on the social sign-in buttons. */
type SocialProvider = 'apple' | 'google';

export default function WelcomeScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { startSSOFlow } = useSSO();

  const [pending, setPending] = useState<SocialProvider | null>(null);

  const completeSocialSignIn = useCallback(
    async (provider: SocialProvider) => {
      if (pending) return;
      setPending(provider);
      try {
        const strategy = provider === 'apple' ? 'oauth_apple' : 'oauth_google';
        // `makeRedirectUri()` builds a scheme-aware URL: `exp://...` in
        // Expo Go, `clickfy://...` in production builds. Clerk pairs this
        // with their hosted OAuth handler so we don't need a callback page.
        const redirectUrl = AuthSession.makeRedirectUri();

        const { createdSessionId, setActive } = await startSSOFlow({
          strategy,
          redirectUrl,
        });

        if (createdSessionId && setActive) {
          await setActive({ session: createdSessionId });
          // The auth-layout redirect flips us to /(tabs) as soon as
          // `isSignedIn` updates — no explicit navigation here.
        }
      } catch (err) {
        // Cancellation (user dismissed the browser sheet) is not an error.
        const msg = err instanceof Error ? err.message : '';
        if (/cancel|dismiss|user_cancelled/i.test(msg)) {
          return;
        }
        if (isClerkAPIResponseError(err)) {
          const first = err.errors?.[0];
          Alert.alert(
            'Sign in failed',
            first?.longMessage ?? first?.message ?? 'Please try again.',
          );
        } else {
          console.warn(`[welcome] ${provider} oauth error`, err);
          Alert.alert(
            'Sign in failed',
            'Something went wrong. Please try again or use email.',
          );
        }
      } finally {
        setPending(null);
      }
    },
    [pending, startSSOFlow],
  );

  // Entrance animation — staggered fade-up on each block below the hero.
  const brandOpacity = useSharedValue(0);
  const brandTy = useSharedValue(16);
  const buttonsOpacity = useSharedValue(0);
  const buttonsTy = useSharedValue(16);
  const tosOpacity = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled().catch(
        () => false,
      );
      if (cancelled) return;
      if (reduceMotion) {
        brandOpacity.value = withTiming(1, { duration: 200 });
        buttonsOpacity.value = withTiming(1, { duration: 200 });
        tosOpacity.value = withTiming(1, { duration: 200 });
        brandTy.value = 0;
        buttonsTy.value = 0;
        return;
      }
      const easing = Easing.out(Easing.cubic);
      brandOpacity.value = withDelay(120, withTiming(1, { duration: 320, easing }));
      brandTy.value = withDelay(120, withTiming(0, { duration: 320, easing }));
      buttonsOpacity.value = withDelay(240, withTiming(1, { duration: 320, easing }));
      buttonsTy.value = withDelay(240, withTiming(0, { duration: 320, easing }));
      tosOpacity.value = withDelay(440, withTiming(1, { duration: 280, easing }));
    })();
    return () => {
      cancelled = true;
    };
  }, [brandOpacity, brandTy, buttonsOpacity, buttonsTy, tosOpacity]);

  const brandStyle = useAnimatedStyle(() => ({
    opacity: brandOpacity.value,
    transform: [{ translateY: brandTy.value }],
  }));
  const buttonsStyle = useAnimatedStyle(() => ({
    opacity: buttonsOpacity.value,
    transform: [{ translateY: buttonsTy.value }],
  }));
  const tosStyle = useAnimatedStyle(() => ({ opacity: tosOpacity.value }));

  const fadeColor = colors.bg;
  const fadeTransparent = `${colors.bg}00`;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* ─── Hero ─── */}
      <View
        style={[
          styles.hero,
          { paddingTop: insets.top + 8, pointerEvents: 'none' },
        ]}
      >
        <FloatingDeck layout="orbit" sources={slide1Images} />
        {/* Bottom fade so the brand zone reads on `colors.bg`. */}
        <LinearGradient
          colors={[fadeTransparent, fadeColor] as const}
          locations={[0, 0.85]}
          style={styles.heroFade}
        />
      </View>

      {/* ─── Brand zone ─── */}
      <Animated.View style={[styles.brand, brandStyle]}>
        <Logo width={188} />
        <Text
          variant="display"
          color="ink"
          italic
          align="center"
          style={styles.tagline}
        >
          Make every product look unforgettable.
        </Text>
      </Animated.View>

      {/* ─── Auth buttons ─── */}
      <Animated.View style={[styles.buttons, buttonsStyle]}>
        <Stack gap="sm">
          {/* Apple Sign-In is an iOS-first UX — Android users get the web
              flow which adds friction. Apple's App Store policy still
              requires offering Sign in with Apple alongside Google on iOS. */}
          {Platform.OS === 'ios' && (
            <Button
              variant="primary"
              size="lg"
              full
              haptic="medium"
              loading={pending === 'apple'}
              disabled={pending !== null && pending !== 'apple'}
              onPress={() => completeSocialSignIn('apple')}
              leading={<Icon name="apple" weight="fill" size={18} color={colors.surface} />}
            >
              Continue with Apple
            </Button>
          )}

          <Button
            variant="ghost"
            size="lg"
            full
            haptic="medium"
            loading={pending === 'google'}
            disabled={pending !== null && pending !== 'google'}
            onPress={() => completeSocialSignIn('google')}
            leading={<GoogleG size={18} />}
          >
            Continue with Google
          </Button>

          <Button
            variant="ghost"
            size="lg"
            full
            haptic="light"
            disabled={pending !== null}
            onPress={() => router.push('/(auth)/sign-in')}
            leading={<Icon name="envelope" size={18} color={colors.ink} />}
          >
            Continue with email
          </Button>
        </Stack>
      </Animated.View>

      {/* ─── ToS ─── */}
      <Animated.View
        style={[styles.tos, { paddingBottom: insets.bottom + 16 }, tosStyle]}
      >
        <Box>
          <Text
            variant="caption"
            color="inkSubtle"
            align="center"
            style={{ lineHeight: 18 }}
          >
            By continuing you agree to our{' '}
            <Text variant="caption" color="ink" weight="600">
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text variant="caption" color="ink" weight="600">
              Privacy Policy
            </Text>
            .
          </Text>
        </Box>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  hero: {
    // Hero claims the upper portion of the screen and contains its own
    // gradient fade — no margin trick like the old hero needed.
    flex: 1.15,
    minHeight: 360,
    position: 'relative',
    justifyContent: 'center',
  },
  heroFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },
  brand: {
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 10,
    marginTop: -8,
  },
  tagline: {
    fontSize: 22,
    lineHeight: 28,
    maxWidth: 320,
  },
  buttons: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  tos: {
    marginTop: 'auto',
    paddingHorizontal: 24,
    paddingTop: 16,
  },
});
