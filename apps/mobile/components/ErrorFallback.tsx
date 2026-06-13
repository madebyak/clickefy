import { Button, Stack, Text, useTheme } from '@clickfy/ui';
import type { FallbackProps } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('errors');

  // `react-error-boundary` types `error` as `{}` (errors can be
  // anything thrown), so guard before reading `.message`.
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message: unknown }).message)
        : null;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}
      >
        <Icon name="warning" size={32} color={accent.solid} weight="fill" />
      </View>

      <Stack gap="sm" align="center" style={{ maxWidth: 300 }}>
        <Text variant="title" color="ink" align="center" style={{ fontSize: 22 }}>
          {t('title')}
        </Text>
        <Text variant="body" color="inkMuted" align="center">
          {t('body')}
        </Text>
        {__DEV__ && errorMessage ? (
          <Text
            variant="mono"
            color="danger"
            align="center"
            style={{ fontSize: 12, marginTop: 8 }}
            numberOfLines={4}
          >
            {errorMessage}
          </Text>
        ) : null}
      </Stack>

      <View style={{ marginTop: 32, width: '100%', maxWidth: 280 }}>
        <Button variant="accent" size="lg" full haptic="medium" onPress={resetErrorBoundary}>
          {t('tryAgain')}
        </Button>
      </View>
    </View>
  );
}
