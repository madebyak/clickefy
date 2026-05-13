/**
 * Verify — 6-digit OTP entry, auto-submit, live resend cooldown.
 *
 * Reads the challenge handle (`requestId`, `email`, `expiresAt`,
 * `resendCooldownSec`) from URL params, then:
 *   - Auto-submits when 6 digits are entered.
 *   - Shows a per-second countdown until the resend button unlocks.
 *   - Re-issues a fresh challenge on resend and swaps in the new
 *     `requestId` without leaving the screen.
 *   - On success, routes to `/(auth)/paywall` (first-launch users see the
 *     paywall once; subsequent users skip it via the auth gate).
 *
 * Rate-limit protection:
 *   - Client-side: locks the input after MAX_FAILED_ATTEMPTS wrong codes
 *     and prompts the user to request a new code.
 *   - Server-side: handles Clerk's `too_many_requests` (429) response
 *     with a timed lockout using the Retry-After value.
 */

import { useSignIn, useSignUp } from '@clerk/expo/legacy';
import { isClerkAPIResponseError } from '@clerk/react/errors';
import { Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OtpInput } from '@/components/auth/OtpInput';
import { Icon } from '@/components/ui/Icon';
import { tap } from '@/lib/haptics';

/** How long to wait before the user can resend a code, in seconds. */
const RESEND_COOLDOWN_SEC = 30;

/** Lock the OTP input after this many consecutive wrong codes. */
const MAX_FAILED_ATTEMPTS = 5;

type Flow = 'sign-in' | 'sign-up';

export default function VerifyScreen() {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const raw = useLocalSearchParams<Record<string, string>>();

  const { signIn, setActive: setSignInActive, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: signUpLoaded } = useSignUp();

  const email = typeof raw.email === 'string' ? raw.email : '';
  const flow: Flow = raw.flow === 'sign-up' ? 'sign-up' : 'sign-in';
  const isLoaded = flow === 'sign-up' ? signUpLoaded : signInLoaded;
  const hasChallenge = !!email;

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(RESEND_COOLDOWN_SEC);
  const [resending, setResending] = useState(false);
  const [locked, setLocked] = useState(false);

  const submitInFlight = useRef(false);
  const failedAttempts = useRef(0);

  // ── Resend cooldown ticker.
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setInterval(() => {
      setResendCountdown((n) => (n > 0 ? n - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [resendCountdown]);

  // ── Submit handler — fires on auto-submit AND on manual button press.
  const submit = useCallback(
    async (value: string) => {
      if (!isLoaded || submitInFlight.current || locked) return;
      submitInFlight.current = true;
      setSubmitting(true);
      setError(null);
      try {
        if (flow === 'sign-up') {
          if (!signUp) throw new Error('Sign-up not ready');
          const result = await signUp.attemptEmailAddressVerification({ code: value });
          if (result.status === 'complete') {
            failedAttempts.current = 0;
            await setSignUpActive({ session: result.createdSessionId });
            tap('success');
            router.replace('/(auth)/paywall');
          } else {
            console.warn('[verify] sign-up not complete', {
              status: result.status,
              missingFields: result.missingFields,
              unverifiedFields: result.unverifiedFields,
            });
            const missing = (result.missingFields ?? []).filter(
              (f) => f !== 'email_address',
            );
            const human =
              missing.length > 0
                ? `Your account needs: ${missing.join(', ')}. Check your Clerk dashboard sign-up settings.`
                : 'Email verified, but sign-up could not complete. Check the Metro logs for missing fields.';
            setError(human);
            setSubmitting(false);
            submitInFlight.current = false;
          }
        } else {
          if (!signIn) throw new Error('Sign-in not ready');
          const result = await signIn.attemptFirstFactor({
            strategy: 'email_code',
            code: value,
          });
          if (result.status === 'complete') {
            failedAttempts.current = 0;
            await setSignInActive({ session: result.createdSessionId });
            tap('success');
            router.replace('/(auth)/paywall');
          } else {
            console.warn('[verify] sign-in not complete', {
              status: result.status,
            });
            setError(
              `Sign-in not complete (status: ${result.status}). See logs.`,
            );
            setSubmitting(false);
            submitInFlight.current = false;
          }
        }
      } catch (err) {
        if (isClerkAPIResponseError(err)) {
          const first = err.errors?.[0];
          const errCode = first?.code;
          const message = first?.longMessage ?? first?.message ?? 'That code didn\u2019t work.';
          console.warn('[verify] clerk api error', {
            code: errCode,
            message,
            meta: first?.meta,
          });

          if (errCode === 'too_many_requests') {
            const retryMeta = first?.meta as Record<string, unknown> | undefined;
            const waitSec = typeof retryMeta?.retryAfter === 'number' ? retryMeta.retryAfter : 60;
            setLocked(true);
            setError(`Too many attempts. Please wait ${waitSec} seconds before trying again.`);
            setTimeout(() => setLocked(false), waitSec * 1000);
            setCode('');
          } else if (errCode === 'verification_already_verified' && flow === 'sign-up' && signUp) {
            const missing = (signUp.missingFields ?? []).filter(
              (f) => f !== 'email_address',
            );
            if (signUp.status === 'complete' && signUp.createdSessionId) {
              await setSignUpActive({ session: signUp.createdSessionId });
              tap('success');
              router.replace('/(auth)/paywall');
              return;
            }
            setError(
              missing.length > 0
                ? `Email verified. Sign-up still needs: ${missing.join(', ')}. Update your Clerk dashboard sign-up settings to passwordless email.`
                : 'Email already verified, but sign-up can\u2019t complete. Check Metro logs.',
            );
          } else {
            failedAttempts.current += 1;
            if (failedAttempts.current >= MAX_FAILED_ATTEMPTS) {
              setLocked(true);
              setError('Too many incorrect codes. Please request a new one.');
              setCode('');
            } else {
              const remaining = MAX_FAILED_ATTEMPTS - failedAttempts.current;
              setError(`${message} ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
              if (errCode === 'verification_expired') {
                setCode('');
              }
            }
          }
        } else {
          console.warn('[verify] non-clerk error', err);
          setError('Something went wrong. Please try again.');
        }
        setSubmitting(false);
        submitInFlight.current = false;
      }
    },
    [flow, isLoaded, locked, router, setSignInActive, setSignUpActive, signIn, signUp],
  );

  const handleResend = async () => {
    if (!isLoaded || resendCountdown > 0 || resending) return;
    setResending(true);
    setError(null);
    setCode('');
    try {
      if (flow === 'sign-up') {
        if (!signUp) throw new Error('Sign-up not ready');
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      } else {
        if (!signIn) throw new Error('Sign-in not ready');
        const factor = signIn.supportedFirstFactors?.find(
          (f) => f.strategy === 'email_code',
        );
        if (!factor) throw new Error('email_code factor unavailable');
        await signIn.prepareFirstFactor({
          strategy: 'email_code',
          emailAddressId: (factor as { emailAddressId: string }).emailAddressId,
        });
      }
      tap('light');
      failedAttempts.current = 0;
      setLocked(false);
      setResendCountdown(RESEND_COOLDOWN_SEC);
    } catch (err) {
      if (isClerkAPIResponseError(err)) {
        const first = err.errors?.[0];
        if (first?.code === 'too_many_requests') {
          const retryMeta = first?.meta as Record<string, unknown> | undefined;
          const waitSec = typeof retryMeta?.retryAfter === 'number' ? retryMeta.retryAfter : 60;
          setError(`Too many resend attempts. Please wait ${waitSec} seconds.`);
          setResendCountdown(waitSec);
        } else {
          setError(first?.longMessage ?? first?.message ?? 'Could not resend the code.');
        }
      } else {
        setError("We couldn't resend the code. Try again in a moment.");
      }
    } finally {
      setResending(false);
    }
  };

  const handleChangeEmail = () => {
    tap('light');
    router.back();
  };

  // ── No challenge — bail out (e.g. user landed here from a deep link).
  const fallback = useMemo(
    () =>
      !hasChallenge ? (
        <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
          <Text variant="title" color="ink" style={{ fontSize: 22 }}>
            This sign-in link expired
          </Text>
          <Text variant="body" color="inkMuted" align="center">
            Start over from the sign-in screen — it only takes a second.
          </Text>
          <Pressable
            onPress={() => router.replace('/(auth)/welcome')}
            haptic="light"
            pressedOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Back to welcome"
            style={{ marginTop: 12, paddingVertical: 12, paddingHorizontal: 22, borderRadius: 14, backgroundColor: accent.solid }}
          >
            <Text variant="caption" weight="700" style={{ color: colors.surface, fontSize: 14 }}>
              Back to start
            </Text>
          </Pressable>
        </View>
      ) : null,
    [accent.solid, hasChallenge, colors.bg, colors.surface, router],
  );

  if (!hasChallenge) return fallback;

  const resendDisabled = resendCountdown > 0 || resending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ─── Top bar ─── */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 8,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={() => router.back()}
          haptic="light"
          pressedOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevronLeft" size={22} color={colors.ink} weight="bold" />
        </Pressable>
      </View>

      {/* ─── Body ─── */}
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16, gap: 32 }}>
        <Stack gap="sm">
          <Text variant="title" color="ink" style={{ fontSize: 30, lineHeight: 34, letterSpacing: -0.8 }}>
            Check your email
          </Text>
          <Text variant="body" color="inkMuted" style={{ lineHeight: 22 }}>
            We sent a 6-digit code to{' '}
            <Text variant="body" color="ink" weight="700">
              {email}
            </Text>
            .
          </Text>
        </Stack>

        {/* OTP cells */}
        <View style={{ alignItems: 'center', gap: 10 }}>
          <OtpInput
            value={code}
            onChange={(v) => {
              setCode(v);
              if (error) setError(null);
            }}
            onComplete={(v) => void submit(v)}
            error={!!error}
            disabled={submitting || locked}
            autoFocus
          />

          {/* Reserved space so layout doesn't shift on submit/error. */}
          <View style={{ minHeight: 24, justifyContent: 'center', alignItems: 'center' }}>
            {submitting ? (
              <ActivityIndicator color={accent.solid} />
            ) : error ? (
              <Text variant="caption" color="danger" align="center">
                {error}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Resend row */}
        <View style={{ alignItems: 'center', gap: 12 }}>
          <Pressable
            onPress={handleResend}
            haptic="light"
            pressedOpacity={0.7}
            disabled={resendDisabled}
            accessibilityRole="button"
            accessibilityLabel="Resend code"
            accessibilityState={{ disabled: resendDisabled }}
            style={{ paddingVertical: 10, paddingHorizontal: 16, opacity: resendDisabled ? 0.5 : 1 }}
          >
            <Text variant="caption" color="ink" weight="700" style={{ fontSize: 14 }}>
              {resending
                ? 'Sending\u2026'
                : resendCountdown > 0
                  ? `Resend in ${resendCountdown}s`
                  : 'Resend code'}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleChangeEmail}
            haptic="light"
            pressedOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel="Change email address"
            style={{ paddingVertical: 6 }}
          >
            <Text variant="caption" color="inkMuted" style={{ fontSize: 13.5 }}>
              Wrong email?{' '}
              <Text variant="caption" color="ink" weight="700" style={{ fontSize: 13.5 }}>
                Change it
              </Text>
            </Text>
          </Pressable>
        </View>

        <View style={{ flex: 1 }} />

        {__DEV__ ? (
          <View style={{ paddingBottom: insets.bottom + 20, alignItems: 'center' }}>
            <Text variant="caption" color="inkSubtle" style={{ fontSize: 12 }} align="center">
              [dev] Any 6-digit code works. The real one is logged in your Metro console.
            </Text>
          </View>
        ) : (
          <View style={{ paddingBottom: insets.bottom + 12 }} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
