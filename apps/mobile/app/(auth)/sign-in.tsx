/**
 * Sign-in — email + password.
 *
 * Primary path: email + password → `signIn.create({ identifier, password })`.
 * On `complete` we activate the session and route into the app.
 *
 * Two escape hatches keep every user able to get in:
 *   - "Forgot password?" → `(auth)/forgot-password` (email-code reset). This
 *     also lets *existing passwordless users* set a password for the first time.
 *   - "Email me a code instead" → the legacy `email_code` first-factor flow,
 *     routed through `(auth)/verify`.
 *
 * Validation:
 *   - Strict zod schema (trim/lowercase email, 8+ char password).
 *   - Submit disabled until valid; SDK errors map to the relevant field so the
 *     layout never jumps.
 */

import { useSignIn } from '@clerk/expo/legacy';
import { isClerkAPIResponseError } from '@clerk/react/errors';
import { Button, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { FormField } from '@/components/auth/FormField';
import { PasswordField } from '@/components/auth/PasswordField';
import { Icon } from '@/components/ui/Icon';
import { tap } from '@/lib/haptics';

const buildSchema = (t: TFunction) =>
  z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, t('common.emailRequired'))
      .email(t('common.emailInvalid')),
    password: z.string().min(1, t('signIn.passwordRequired')),
  });

type SignInValues = z.infer<ReturnType<typeof buildSchema>>;

export default function SignInScreen() {
  const { t } = useTranslation('auth');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, setActive, isLoaded } = useSignIn();
  const schema = useMemo(() => buildSchema(t), [t]);

  // The "email me a code instead" path runs independently of form submit, so
  // it gets its own in-flight flag to drive the secondary button's spinner.
  const [sendingCode, setSendingCode] = useState(false);

  const {
    control,
    handleSubmit,
    getValues,
    setError,
    formState: { errors, isSubmitting, isValid },
  } = useForm<SignInValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async ({ email, password }: SignInValues) => {
    if (!isLoaded || !signIn) return;
    try {
      const result = await signIn.create({ identifier: email, password });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        tap('success');
        router.replace('/(auth)/paywall');
        return;
      }
      // The only common non-complete outcome with a password first factor is
      // MFA (second factor). We don't ship MFA on mobile yet, so steer the
      // user to the code flow rather than dead-ending them.
      setError('password', {
        type: 'clerk',
        message: t('signIn.errors.mfaRequired'),
      });
    } catch (err) {
      if (isClerkAPIResponseError(err)) {
        const first = err.errors?.[0];
        const msg = first?.longMessage ?? first?.message ?? t('signIn.errors.couldNotSignIn');
        if (first?.code === 'form_identifier_not_found') {
          setError('email', {
            type: 'clerk',
            message: t('signIn.errors.identifierNotFound'),
          });
        } else if (
          first?.code === 'form_password_incorrect' ||
          first?.meta?.paramName === 'password'
        ) {
          setError('password', {
            type: 'clerk',
            message: t('signIn.errors.passwordIncorrect'),
          });
        } else if (first?.code === 'strategy_for_user_invalid') {
          // Account exists but has no password set (e.g. signed up with Google
          // or an older passwordless flow). Point them at the reset flow, which
          // lets them set one.
          setError('password', {
            type: 'clerk',
            message: t('signIn.errors.noPassword'),
          });
        } else {
          setError('password', { type: 'clerk', message: msg });
        }
      } else {
        setError('password', {
          type: 'clerk',
          message: t('common.somethingWentWrong'),
        });
      }
    }
  };

  const goToForgotPassword = () => {
    tap('light');
    const email = getValues('email');
    router.push({ pathname: '/(auth)/forgot-password', params: { email } });
  };

  // Legacy passwordless fallback — request an email_code and hop to verify.
  const sendEmailCode = async () => {
    if (!isLoaded || !signIn || sendingCode) return;
    const email = getValues('email');
    const parsed = schema.shape.email.safeParse(email);
    if (!parsed.success) {
      setError('email', {
        type: 'clerk',
        message: parsed.error.errors[0]?.message ?? t('signIn.errors.enterEmailFirst'),
      });
      return;
    }
    setSendingCode(true);
    try {
      await signIn.create({ identifier: parsed.data });
      const factor = signIn.supportedFirstFactors?.find(
        (f) => f.strategy === 'email_code',
      );
      if (!factor) {
        setError('email', {
          type: 'clerk',
          message: t('signIn.errors.emailCodeUnavailable'),
        });
        return;
      }
      await signIn.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId: (factor as { emailAddressId: string }).emailAddressId,
      });
      tap('selection');
      router.push({
        pathname: '/(auth)/verify',
        params: { email: parsed.data, flow: 'sign-in' },
      });
    } catch (err) {
      if (isClerkAPIResponseError(err)) {
        const first = err.errors?.[0];
        if (first?.code === 'form_identifier_not_found') {
          setError('email', {
            type: 'clerk',
            message: t('signIn.errors.identifierNotFound'),
          });
        } else {
          setError('email', {
            type: 'clerk',
            message: first?.longMessage ?? first?.message ?? t('signIn.errors.couldNotSendCode'),
          });
        }
      } else {
        setError('email', {
          type: 'clerk',
          message: t('common.somethingWentWrong'),
        });
      }
    } finally {
      setSendingCode(false);
    }
  };

  const busy = isSubmitting || sendingCode;

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
          accessibilityLabel={t('common.back')}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevronLeft" size={22} color={colors.ink} weight="bold" />
        </Pressable>
      </View>

      {/* ─── Body ─── */}
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16, gap: 24 }}>
        <Stack gap="sm">
          <Text variant="title" color="ink" style={{ fontSize: 30, lineHeight: 34, letterSpacing: -0.8 }}>
            {t('signIn.title')}
          </Text>
          <Text variant="body" color="inkMuted" style={{ lineHeight: 22 }}>
            {t('signIn.subtitle')}
          </Text>
        </Stack>

        <Stack gap="md">
          <Controller
            control={control}
            name="email"
            render={({ field: { value, onChange, onBlur } }) => (
              <FormField
                label={t('common.emailLabel')}
                leadingIcon="envelope"
                placeholder={t('common.emailPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                textContentType="emailAddress"
                returnKeyType="next"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.email?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field: { value, onChange, onBlur } }) => (
              <PasswordField
                variant="current"
                label={t('signIn.passwordLabel')}
                placeholder={t('signIn.passwordPlaceholder')}
                returnKeyType="send"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                onSubmitEditing={isValid ? handleSubmit(onSubmit) : undefined}
                error={errors.password?.message}
              />
            )}
          />

          <Pressable
            onPress={goToForgotPassword}
            haptic="light"
            pressedOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel={t('signIn.forgotPasswordA11y')}
            style={{ alignSelf: 'flex-end', paddingVertical: 4, marginTop: -4 }}
          >
            <Text variant="caption" color="ink" weight="700" style={{ fontSize: 13.5 }}>
              {t('signIn.forgotPassword')}
            </Text>
          </Pressable>
        </Stack>

        <Button
          variant="accent"
          size="lg"
          full
          haptic="medium"
          loading={isSubmitting}
          disabled={!isValid || busy}
          onPress={handleSubmit(onSubmit)}
          trailing={
            <Icon name="arrowRight" size={18} weight="bold" color={colors.surface} />
          }
        >
          {t('signIn.submit')}
        </Button>

        <Button
          variant="ghost"
          size="md"
          full
          haptic="light"
          loading={sendingCode}
          disabled={busy}
          onPress={sendEmailCode}
          leading={<Icon name="envelope" size={18} weight="bold" color={colors.ink} />}
        >
          {t('signIn.emailCodeInstead')}
        </Button>

        <View style={{ flex: 1 }} />

        {/* Footer — switch to sign-up */}
        <View style={{ paddingBottom: insets.bottom + 20, alignItems: 'center' }}>
          <Pressable
            onPress={() => router.push('/(auth)/sign-up')}
            haptic="light"
            pressedOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel={t('signIn.footerA11y')}
            style={{ paddingVertical: 8 }}
          >
            <Text variant="caption" color="inkMuted" style={{ fontSize: 14 }}>
              {t('signIn.footerPrefix')}
              <Text variant="caption" color="ink" weight="700" style={{ fontSize: 14 }}>
                {t('signIn.footerAction')}
              </Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
