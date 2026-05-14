/**
 * Sign-up — new account registration.
 *
 * Captures full name + email + ToS acceptance, then asks the SDK for an
 * OTP via `signUp`. The name is stored against the pending challenge and
 * persists into the session when verification succeeds.
 *
 * Form rules:
 *   - Name ≥ 2 trimmed characters.
 *   - Email — same RFC-ish rules as sign-in.
 *   - ToS checkbox is required (`z.literal(true)`).
 *   - Submit disabled until all three pass validation.
 */

import { useSignUp } from '@clerk/expo/legacy';
import { isClerkAPIResponseError } from '@clerk/react/errors';
import { Button, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { Checkbox } from 'expo-checkbox';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { FormField } from '@/components/auth/FormField';
import { Icon } from '@/components/ui/Icon';
import { tap } from '@/lib/haptics';

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Please enter your full name')
    .max(60, 'That name is a bit too long'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  agreedToTos: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms to continue' }),
  }),
});

type SignUpValues = z.infer<typeof schema>;

export default function SignUpScreen() {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp, isLoaded } = useSignUp();

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isValid },
  } = useForm<SignUpValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    // `agreedToTos: false` is a deliberate type cast — zod's `literal(true)`
    // forbids `false` at runtime, but rhf needs an initial value to render.
    defaultValues: { name: '', email: '', agreedToTos: false as unknown as true },
  });

  const onSubmit = async ({ name, email }: SignUpValues) => {
    if (!isLoaded || !signUp) return;
    try {
      // Split the user's full name on the last space — Clerk wants first
      // + last separately. This is best-effort; users with single names
      // or culturally inverted ordering get the whole string as first.
      const trimmed = name.trim();
      const lastSpace = trimmed.lastIndexOf(' ');
      const firstName = lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed;
      const lastName = lastSpace > 0 ? trimmed.slice(lastSpace + 1) : '';

      await signUp.create({
        emailAddress: email,
        firstName,
        ...(lastName && { lastName }),
      });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });

      tap('selection');
      router.push({
        pathname: '/(auth)/verify',
        params: { email, flow: 'sign-up' },
      });
    } catch (err) {
      if (isClerkAPIResponseError(err)) {
        const first = err.errors?.[0];
        const msg = first?.longMessage ?? first?.message ?? 'Could not create the account.';
        if (first?.code === 'form_identifier_exists') {
          setError('email', {
            type: 'clerk',
            message: 'An account with this email already exists. Try signing in.',
          });
        } else if (first?.meta?.paramName === 'first_name') {
          setError('name', { type: 'clerk', message: msg });
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

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, gap: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Stack gap="sm">
          <Text variant="title" color="ink" style={{ fontSize: 30, lineHeight: 34, letterSpacing: -0.8 }}>
            Create your account
          </Text>
          <Text variant="body" color="inkMuted" style={{ lineHeight: 22 }}>
            Free to start. No card required.
          </Text>
        </Stack>

        <Stack gap="md">
          <Controller
            control={control}
            name="name"
            render={({ field: { value, onChange, onBlur } }) => (
              <FormField
                label="Full name"
                leadingIcon="profile"
                placeholder="Ada Lovelace"
                autoCapitalize="words"
                autoComplete="name"
                autoCorrect={false}
                textContentType="name"
                returnKeyType="next"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.name?.message}
              />
            )}
          />

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

          <Controller
            control={control}
            name="agreedToTos"
            render={({ field: { value, onChange } }) => (
              <Pressable
                onPress={() => onChange(!value)}
                haptic="selection"
                pressedOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!value }}
                accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 4 }}
              >
                <Checkbox
                  value={!!value}
                  onValueChange={onChange}
                  color={value ? accent.solid : undefined}
                  style={{ marginTop: 2, borderRadius: 6 }}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="caption" color="ink" style={{ lineHeight: 20, fontSize: 13.5 }}>
                    I agree to the{' '}
                    <Text variant="caption" color="ink" weight="700" style={{ fontSize: 13.5 }}>
                      Terms of Service
                    </Text>{' '}
                    and{' '}
                    <Text variant="caption" color="ink" weight="700" style={{ fontSize: 13.5 }}>
                      Privacy Policy
                    </Text>
                    .
                  </Text>
                  {errors.agreedToTos ? (
                    <Text variant="caption" color="danger" style={{ marginTop: 4, fontSize: 12 }}>
                      {errors.agreedToTos.message}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            )}
          />
        </Stack>

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
          Create account
        </Button>

        <View style={{ flex: 1 }} />

        {/* Footer — switch back to sign-in */}
        <View style={{ paddingBottom: insets.bottom + 20, alignItems: 'center' }}>
          <Pressable
            onPress={() => router.replace('/(auth)/sign-in')}
            haptic="light"
            pressedOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel="Sign in to an existing account"
            style={{ paddingVertical: 8 }}
          >
            <Text variant="caption" color="inkMuted" style={{ fontSize: 14 }}>
              Already have an account?{' '}
              <Text variant="caption" color="ink" weight="700" style={{ fontSize: 14 }}>
                Sign in
              </Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
