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
import * as Sentry from '@sentry/react-native';
import { Box, Button, Stack, Text, useTheme } from '@clickfy/ui';
import * as AuthSession from 'expo-auth-session';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('auth');
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
        // `makeRedirectUri({ path })` builds a scheme-aware URL: `exp://...`
        // in Expo Go, `clickfy://sso-callback` in production builds. The
        // explicit `sso-callback` path matches Clerk's own internal default
        // — a bare-scheme redirect (`clickfy://`) is not reliably detected
        // by Chrome Custom Tabs on Android, which silently dismisses the
        // browser and returns a non-`success` result (the bug we're chasing).
        const redirectUrl = AuthSession.makeRedirectUri({ path: 'sso-callback' });

        const { createdSessionId, setActive, authSessionResult, signIn, signUp } =
          await startSSOFlow({
            strategy,
            redirectUrl,
          });

        if (createdSessionId && setActive) {
          await setActive({ session: createdSessionId });
          // The auth-layout redirect flips us to /(tabs) as soon as
          // `isSignedIn` updates — no explicit navigation here.
        } else {
          // No session came back. This is the silent failure path the user
          // is hitting: the browser closed without a successful redirect, or
          // Clerk needs a follow-up step we didn't take. Capture rich
          // diagnostics to Sentry so we can see WHY in production (the
          // dismiss/cancel path never throws, so nothing surfaced before).
          Sentry.captureMessage('[oauth] SSO flow returned no session', {
            level: 'warning',
            extra: {
              provider,
              redirectUrl,
              authSessionResultType: authSessionResult?.type ?? 'none',
              authSessionResultUrl:
                authSessionResult && 'url' in authSessionResult
                  ? authSessionResult.url
                  : null,
              firstFactorStatus: signIn?.firstFactorVerification?.status ?? null,
              firstFactorError:
                signIn?.firstFactorVerification?.error?.message ?? null,
              externalVerificationRedirectURL:
                signIn?.firstFactorVerification?.externalVerificationRedirectURL?.toString() ??
                null,
              signInStatus: signIn?.status ?? null,
              signUpStatus: signUp?.status ?? null,
            },
          });
        }
      } catch (err) {
        // Cancellation (user dismissed the browser sheet) is not an error.
        const msg = err instanceof Error ? err.message : '';
        if (/cancel|dismiss|user_cancelled/i.test(msg)) {
          return;
        }
        if (isClerkAPIResponseError(err)) {
          const first = err.errors?.[0];
          Sentry.captureException(err, {
            level: 'warning',
            extra: { provider, clerkErrorCode: first?.code, clerkErrorMessage: first?.message },
          });
          Alert.alert(
            t('welcome.signInFailedTitle'),
            first?.longMessage ?? first?.message ?? t('welcome.tryAgain'),
          );
        } else {
          console.warn(`[welcome] ${provider} oauth error`, err);
          Sentry.captureException(err, { extra: { provider, where: 'sso_flow' } });
          Alert.alert(
            t('welcome.signInFailedTitle'),
            t('welcome.socialError'),
          );
        }
      } finally {
        setPending(null);
      }
    },
    [pending, startSSOFlow, t],
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
          {t('welcome.tagline')}
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
              {t('welcome.continueApple')}
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
            {t('welcome.continueGoogle')}
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
            {t('welcome.continueEmail')}
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
            {t('welcome.tos.prefix')}
            <Text variant="caption" color="ink" weight="600">
              {t('welcome.tos.terms')}
            </Text>
            {t('welcome.tos.and')}
            <Text variant="caption" color="ink" weight="600">
              {t('welcome.tos.privacy')}
            </Text>
            {t('welcome.tos.period')}
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
