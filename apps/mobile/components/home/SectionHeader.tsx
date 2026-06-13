import { HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, subtitle, actionLabel, onAction }: SectionHeaderProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('home');
  const resolvedActionLabel = actionLabel ?? t('section.seeAll');

  return (
    <HStack px="lg" align="flex-end" justify="space-between" mb="md" style={{ width: '100%' }}>
      <Stack gap="xs" style={{ flex: 1, marginEnd: 12 }}>
        <Text variant="heading" color="ink" align="start" style={{ lineHeight: 24 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="inkMuted" align="start">
            {subtitle}
          </Text>
        ) : null}
      </Stack>
      {onAction ? (
        <Pressable onPress={onAction} haptic="light" pressedOpacity={0.6} accessibilityRole="link">
          <HStack align="center" gap="xs">
            <Text variant="caption" color="inkMuted" weight="600" style={{ fontSize: 13 }}>
              {resolvedActionLabel}
            </Text>
            <Icon name="chevronRight" size={14} color={colors.inkMuted} weight="bold" />
          </HStack>
        </Pressable>
      ) : null}
    </HStack>
  );
}
