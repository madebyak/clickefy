import { Box, Pressable, Text, useTheme } from '@clickfy/ui';

import { Icon } from '@/components/ui/Icon';

export interface SearchBarProps {
  value?: string;
  placeholder?: string;
  /**
   * When set, the bar advertises a *scoped* search. We swap the
   * placeholder to `Search in ${scopeLabel}` and the consuming page is
   * expected to pre-seed the matching category filter on the search
   * route. Mirrors the Etsy / App Store pattern: search defaults to the
   * surface you're already in, with a clear escape hatch ("✕") on the
   * chip inside `/search`.
   */
  scopeLabel?: string;
  onPress?: () => void;
}

export function SearchBar({
  value,
  placeholder,
  scopeLabel,
  onPress,
}: SearchBarProps) {
  const resolvedPlaceholder =
    placeholder ?? (scopeLabel ? `Search in ${scopeLabel}` : 'Search templates');
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      haptic="light"
      pressedOpacity={0.8}
      accessibilityRole="search"
      accessibilityLabel={resolvedPlaceholder}
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
        {value || resolvedPlaceholder}
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
