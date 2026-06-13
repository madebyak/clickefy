/**
 * Forgot password — step 1 of the reset flow.
 *
 * Captures the account email, asks Clerk to send a `reset_password_email_code`,
 * then routes to `(auth)/reset-password` to collect the code + new password.
 *
 * This screen doubles as a "set a password" entry point for existing users who
 * signed up passwordless (email code / Google) and never had one — the reset
 * flow happily sets a first password on a verified email.
 *
 * The in-progress `SignIn` resource lives on the Clerk client singleton, so the
 * prepared first factor carries over to the next screen automatically.
 */

import { useSignIn } from '@clerk/expo/legacy';
import { isClerkAPIResponseError } from '@clerk/react/errors';
import { Button, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { FormField } from '@/components/auth/FormField';
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
  });

type ForgotValues = z.infer<ReturnType<typeof buildSchema>>;

export default function ForgotPasswordScreen() {
  const { t } = useTranslation('auth');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, isLoaded } = useSignIn();
  const raw = useLocalSearchParams<Record<string, string>>();
  const schema = useMemo(() => buildSchema(t), [t]);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isValid },
  } = useForm<ForgotValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { email: typeof raw.email === 'string' ? raw.email : '' },
  });

  const onSubmit = async ({ email }: ForgotValues) => {
    if (!isLoaded || !signIn) return;
    try {
      await signIn.create({ identifier: email });
      const factor = signIn.supportedFirstFactors?.find(
        (f) => f.strategy === 'reset_password_email_code',
      );
      if (!factor) {
        setError('email', {
          type: 'clerk',
          message: t('forgotPassword.errors.resetUnavailable'),
        });
        return;
      }
      await signIn.prepareFirstFactor({
        strategy: 'reset_password_email_code',
        emailAddressId: (factor as { emailAddressId: string }).emailAddressId,
      });
      tap('selection');
      router.push({ pathname: '/(auth)/reset-password', params: { email } });
    } catch (err) {
      if (isClerkAPIResponseError(err)) {
        const first = err.errors?.[0];
        if (first?.code === 'form_identifier_not_found') {
          setError('email', {
            type: 'clerk',
            message: t('forgotPassword.errors.identifierNotFound'),
          });
        } else {
          setError('email', {
            type: 'clerk',
            message: first?.longMessage ?? first?.message ?? t('forgotPassword.errors.couldNotSendResetCode'),
          });
        }
      } else {
        setError('email', {
          type: 'clerk',
          message: t('common.somethingWentWrong'),
        });
      }
    }
  };

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
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16, gap: 28 }}>
        <Stack gap="sm">
          <Text variant="title" color="ink" style={{ fontSize: 30, lineHeight: 34, letterSpacing: -0.8 }}>
            {t('forgotPassword.title')}
          </Text>
          <Text variant="body" color="inkMuted" style={{ lineHeight: 22 }}>
            {t('forgotPassword.subtitle')}
          </Text>
        </Stack>

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
              returnKeyType="send"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              onSubmitEditing={isValid ? handleSubmit(onSubmit) : undefined}
              error={errors.email?.message}
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
          trailing={<Icon name="arrowRight" size={18} weight="bold" color={colors.surface} />}
        >
          {t('forgotPassword.submit')}
        </Button>

        <View style={{ flex: 1 }} />

        <View style={{ paddingBottom: insets.bottom + 20, alignItems: 'center' }}>
          <Pressable
            onPress={() => router.back()}
            haptic="light"
            pressedOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel={t('forgotPassword.footerA11y')}
            style={{ paddingVertical: 8 }}
          >
            <Text variant="caption" color="inkMuted" style={{ fontSize: 14 }}>
              {t('forgotPassword.footerPrefix')}
              <Text variant="caption" color="ink" weight="700" style={{ fontSize: 14 }}>
                {t('forgotPassword.footerAction')}
              </Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
