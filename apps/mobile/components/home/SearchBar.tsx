import { Box, Pressable, Text, useTheme } from '@clickfy/ui';

import { Icon } from '@/components/ui/Icon';

export interface SearchBarProps {
  value?: string;
  placeholder?: string;
  onPress?: () => void;
}

export function SearchBar({ value, placeholder = 'Search 12,400+ templates', onPress }: SearchBarProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      haptic="light"
      pressedOpacity={0.8}
      accessibilityRole="search"
      accessibilityLabel={placeholder}
      style={{
        height: 52,
        paddingHorizontal: 16,
        borderRadius: 18,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Icon name="search" size={20} color={colors.inkMuted} />
      <Text
        variant="body"
        color={value ? 'ink' : 'inkMuted'}
        style={{ flex: 1 }}
        numberOfLines={1}
      >
        {value || placeholder}
      </Text>
      <Box
        bg="surfaceMuted"
        radius="md"
        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="sliders" size={16} color={colors.ink} />
      </Box>
    </Pressable>
  );
}
