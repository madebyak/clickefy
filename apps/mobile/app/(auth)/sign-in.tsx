/**
 * Sign-in — email entry screen.
 *
 * Captures an email, asks the SDK for an OTP, then routes to
 * `(auth)/verify` carrying the challenge in URL params. New users tap the
 * "Sign up" link at the bottom to switch to the registration funnel.
 *
 * Validation:
 *   - Strict zod schema (whitespace trim, lowercase, RFC-ish email).
 *   - Submit button is disabled until the form is valid.
 *   - SDK-level errors (`AuthError`) are mapped to a single field-level
 *     error message so the layout doesn't jump.
 */

import { useSignIn } from '@clerk/expo/legacy';
import { isClerkAPIResponseError } from '@clerk/react/errors';
import { Button, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { FormField } from '@/components/auth/FormField';
import { Icon } from '@/components/ui/Icon';
import { tap } from '@/lib/haptics';

const schema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
});

type SignInValues = z.infer<typeof schema>;

export default function SignInScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, isLoaded } = useSignIn();

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isValid },
  } = useForm<SignInValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { email: '' },
  });

  const onSubmit = async ({ email }: SignInValues) => {
    if (!isLoaded || !signIn) return;
    try {
      // Create the sign-in attempt with the email identifier — this
      // resolves which factors are eligible. We then explicitly prepare
      // the `email_code` factor, which is what triggers Clerk to send
      // the 6-digit code.
      await signIn.create({ identifier: email });
      const factor = signIn.supportedFirstFactors?.find(
        (f) => f.strategy === 'email_code',
      );
      if (!factor) {
        setError('email', {
          type: 'clerk',
          message: 'Email code sign-in is not enabled for this account.',
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
        params: { email, flow: 'sign-in' },
      });
    } catch (err) {
      if (isClerkAPIResponseError(err)) {
        const first = err.errors?.[0];
        const msg = first?.longMessage ?? first?.message ?? 'Could not start sign-in.';
        // Clerk uses code 'form_identifier_not_found' when the email isn't registered.
        if (first?.code === 'form_identifier_not_found') {
          setError('email', {
            type: 'clerk',
            message: "We don't recognize this email. Tap “Sign up” below to create an account.",
          });
        } else {
          setError('email', { type: 'clerk', message: msg });
        }
      } else {
        setError('email', {
          type: 'clerk',
          message: 'Something went wrong. Please try again.',
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
          accessibilityLabel="Back"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevronLeft" size={22} color={colors.ink} weight="bold" />
        </Pressable>
      </View>

      {/* ─── Body ─── */}
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16, gap: 28 }}>
        <Stack gap="sm">
          <Text variant="title" color="ink" style={{ fontSize: 30, lineHeight: 34, letterSpacing: -0.8 }}>
            Sign in
          </Text>
          <Text variant="body" color="inkMuted" style={{ lineHeight: 22 }}>
            We&apos;ll email you a 6-digit code. No password to remember.
          </Text>
        </Stack>

        <Controller
          control={control}
          name="email"
          render={({ field: { value, onChange, onBlur } }) => (
            <FormField
              label="Email"
              leadingIcon="envelope"
              placeholder="you@example.com"
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
          trailing={
            <Icon name="arrowRight" size={18} weight="bold" color={colors.surface} />
          }
        >
          Continue
        </Button>

        <View style={{ flex: 1 }} />

        {/* Footer — switch to sign-up */}
        <View style={{ paddingBottom: insets.bottom + 20, alignItems: 'center' }}>
          <Pressable
            onPress={() => router.push('/(auth)/sign-up')}
            haptic="light"
            pressedOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel="Create a new account"
            style={{ paddingVertical: 8 }}
          >
            <Text variant="caption" color="inkMuted" style={{ fontSize: 14 }}>
              Don&apos;t have an account?{' '}
              <Text variant="caption" color="ink" weight="700" style={{ fontSize: 14 }}>
                Sign up
              </Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
