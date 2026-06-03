/**
 * Reset password — step 2 of the reset flow.
 *
 * Continues the `SignIn` resource prepared on `(auth)/forgot-password`:
 *   1. `attemptFirstFactor({ strategy: 'reset_password_email_code', code })`
 *      → verifies the emailed code (status → `needs_new_password`).
 *   2. `resetPassword({ password })` → sets the new password (status →
 *      `complete`) and yields a session we activate.
 *
 * If the user lands here without an in-progress reset (deep link / reload),
 * we bail back to the start of the flow.
 */

import { useSignIn } from '@clerk/expo/legacy';
import { isClerkAPIResponseError } from '@clerk/react/errors';
import { Button, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { OtpInput } from '@/components/auth/OtpInput';
import { PasswordField } from '@/components/auth/PasswordField';
import { Icon } from '@/components/ui/Icon';
import { tap } from '@/lib/haptics';

/** How long to wait before the user can resend a code, in seconds. */
const RESEND_COOLDOWN_SEC = 30;

const schema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code'),
  password: z.string().min(8, 'Use at least 8 characters'),
});

type ResetValues = z.infer<typeof schema>;

export default function ResetPasswordScreen() {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, setActive, isLoaded } = useSignIn();
  const raw = useLocalSearchParams<Record<string, string>>();
  const email = typeof raw.email === 'string' ? raw.email : '';

  const [resendCountdown, setResendCountdown] = useState(RESEND_COOLDOWN_SEC);
  const [resending, setResending] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting, isValid },
  } = useForm<ResetValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { code: '', password: '' },
  });

  // Resend cooldown ticker.
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setInterval(() => {
      setResendCountdown((n) => (n > 0 ? n - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [resendCountdown]);

  const onSubmit = async ({ code, password }: ResetValues) => {
    if (!isLoaded || !signIn) return;
    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code,
      });
      if (attempt.status !== 'needs_new_password') {
        setError('code', {
          type: 'clerk',
          message: `Unexpected status: ${attempt.status}. Please try again.`,
        });
        return;
      }
      const result = await signIn.resetPassword({ password });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        tap('success');
        router.replace('/(auth)/paywall');
        return;
      }
      setError('password', {
        type: 'clerk',
        message: 'Extra verification is required to finish. Please sign in again.',
      });
    } catch (err) {
      if (isClerkAPIResponseError(err)) {
        const first = err.errors?.[0];
        const code1 = first?.code;
        const msg = first?.longMessage ?? first?.message ?? 'Could not reset your password.';
        if (code1 === 'form_code_incorrect' || code1 === 'verification_expired') {
          setValue('code', '');
          setError('code', { type: 'clerk', message: msg });
        } else if (first?.meta?.paramName === 'password' || code1 === 'form_password_pwned') {
          setError('password', { type: 'clerk', message: msg });
        } else {
          setError('code', { type: 'clerk', message: msg });
        }
      } else {
        setError('code', {
          type: 'clerk',
          message: 'Something went wrong. Please try again.',
        });
      }
    }
  };

  const handleResend = async () => {
    if (!isLoaded || !signIn || resendCountdown > 0 || resending) return;
    setResending(true);
    try {
      const factor = signIn.supportedFirstFactors?.find(
        (f) => f.strategy === 'reset_password_email_code',
      );
      if (!factor) throw new Error('reset factor unavailable');
      await signIn.prepareFirstFactor({
        strategy: 'reset_password_email_code',
        emailAddressId: (factor as { emailAddressId: string }).emailAddressId,
      });
      tap('light');
      setValue('code', '');
      setResendCountdown(RESEND_COOLDOWN_SEC);
    } catch {
      setError('code', {
        type: 'clerk',
        message: 'Could not resend the code. Try again in a moment.',
      });
    } finally {
      setResending(false);
    }
  };

  // No email in params → the user didn't come through forgot-password.
  if (!email) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <Text variant="title" color="ink" style={{ fontSize: 22 }}>
          Start your password reset
        </Text>
        <Text variant="body" color="inkMuted" align="center">
          Begin from the &quot;Forgot password&quot; screen — it only takes a moment.
        </Text>
        <Pressable
          onPress={() => router.replace('/(auth)/forgot-password')}
          haptic="light"
          pressedOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go to forgot password"
          style={{ marginTop: 12, paddingVertical: 12, paddingHorizontal: 22, borderRadius: 14, backgroundColor: accent.solid }}
        >
          <Text variant="caption" weight="700" style={{ color: colors.surface, fontSize: 14 }}>
            Reset password
          </Text>
        </Pressable>
      </View>
    );
  }

  const resendDisabled = resendCountdown > 0 || resending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
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
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16, gap: 24 }}>
        <Stack gap="sm">
          <Text variant="title" color="ink" style={{ fontSize: 30, lineHeight: 34, letterSpacing: -0.8 }}>
            Set a new password
          </Text>
          <Text variant="body" color="inkMuted" style={{ lineHeight: 22 }}>
            Enter the 6-digit code we sent to{' '}
            <Text variant="body" color="ink" weight="700">
              {email}
            </Text>{' '}
            and choose a new password.
          </Text>
        </Stack>

        <Controller
          control={control}
          name="code"
          render={({ field: { value, onChange } }) => (
            <View style={{ alignItems: 'center', gap: 6 }}>
              <OtpInput
                value={value}
                onChange={onChange}
                error={!!errors.code?.message}
                disabled={isSubmitting}
                autoFocus
              />
              <View style={{ minHeight: 18, justifyContent: 'center' }}>
                {errors.code?.message ? (
                  <Text variant="caption" color="danger" align="center">
                    {errors.code.message}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        />

        <Controller
          control={control}
          name="password"
          render={({ field: { value, onChange, onBlur } }) => (
            <PasswordField
              variant="new"
              label="New password"
              placeholder="At least 8 characters"
              helper="At least 8 characters."
              returnKeyType="send"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              onSubmitEditing={isValid ? handleSubmit(onSubmit) : undefined}
              error={errors.password?.message}
            />
          )}
        />

        <Button
          variant="accent"
          size="lg"
          full
          haptic="medium"
          loading={isSubmitting}
          disabled={!isValid || isSubmitting}
          onPress={handleSubmit(onSubmit)}
          trailing={<Icon name="check" size={18} weight="bold" color={colors.surface} />}
        >
          Update password
        </Button>

        <View style={{ alignItems: 'center' }}>
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
        </View>

        <View style={{ flex: 1 }} />
        <View style={{ paddingBottom: insets.bottom + 12 }} />
      </View>
    </KeyboardAvoidingView>
  );
}
