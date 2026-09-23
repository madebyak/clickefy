/**
 * ErrorState — the one way a screen says "this fetch failed" instead of
 * quietly rendering its empty state. A failed request must never look
 * like "you have nothing here": that sends users hunting for content
 * that exists and hides outages from us.
 *
 * Tonal card, warning glyph, a sentence, and a Retry that re-runs the
 * query. Copy defaults to the `errors` namespace; screens with a more
 * specific sentence override `title` / `body`.
 */

import { Button, Text, useTheme } from '@clickfy/ui';
import { useTranslation } from 'react-i18next';
import { View, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui/Icon';

export interface ErrorStateProps {
  title?: string;
  body?: string;
  onRetry: () => void;
  /** True while the retry is in flight — the button shows its spinner. */
  retrying?: boolean;
  style?: ViewStyle;
}

export function ErrorState({ title, body, onRetry, retrying, style }: ErrorStateProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('errors');
  return (
    <View
      style={[
        {
          padding: 24,
          borderRadius: 22,
          backgroundColor: colors.surfaceMuted,
          alignItems: 'center',
          gap: 10,
        },
        style,
      ]}
    >
      <Icon name="warning" size={22} color={colors.inkMuted} />
      <Text variant="bodySemi" color="ink" align="center">
        {title ?? t('loadTitle')}
      </Text>
      <Text variant="caption" color="inkMuted" align="center">
        {body ?? t('loadBody')}
      </Text>
      <View style={{ marginTop: 4 }}>
        <Button variant="ghost" size="sm" onPress={onRetry} loading={retrying}>
          {t('tryAgain')}
        </Button>
      </View>
    </View>
  );
}
