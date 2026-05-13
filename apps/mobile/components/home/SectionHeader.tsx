import { HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';

import { Icon } from '@/components/ui/Icon';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, subtitle, actionLabel = 'See all', onAction }: SectionHeaderProps) {
  const { colors } = useTheme();
  return (
    <HStack px="lg" align="flex-end" justify="space-between" mb="md">
      <Stack gap="xs" style={{ flex: 1, marginRight: 12 }}>
        <Text variant="heading" color="ink" style={{ lineHeight: 24 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="inkMuted">
            {subtitle}
          </Text>
        ) : null}
      </Stack>
      {onAction ? (
        <Pressable onPress={onAction} haptic="light" pressedOpacity={0.6} accessibilityRole="link">
          <HStack align="center" gap="xs">
            <Text variant="caption" color="inkMuted" weight="600" style={{ fontSize: 13 }}>
              {actionLabel}
            </Text>
            <Icon name="chevronRight" size={14} color={colors.inkMuted} weight="bold" />
          </HStack>
        </Pressable>
      ) : null}
    </HStack>
  );
}
