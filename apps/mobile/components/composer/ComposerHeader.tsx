/**
 * ComposerHeader — ☰ · "Create" · [credits] [✕]
 *
 * The badge is the user's TOTAL balance (what they have); the cost of a
 * generation lives on the Generate button (what this will spend). ✕
 * dismisses the full-screen composer back to the tabs.
 */

import { HStack, Pressable, Text, useTheme } from '@clickfy/ui';
import { View } from 'react-native';

import { Icon } from '@/components/ui/Icon';

function RoundButton({
  icon,
  label,
  onPress,
}: {
  icon: 'menu' | 'close';
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      haptic="light"
      pressedOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={18} color={colors.ink} />
    </Pressable>
  );
}

export function ComposerHeader({
  title,
  credits,
  menuLabel,
  closeLabel,
  onMenu,
  onClose,
}: {
  title: string;
  credits: number;
  menuLabel: string;
  closeLabel: string;
  onMenu: () => void;
  onClose: () => void;
}) {
  const { accent } = useTheme();
  return (
    <HStack align="center" gap="md" style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      <RoundButton icon="menu" label={menuLabel} onPress={onMenu} />
      <Text variant="subhead" color="ink" weight="700" style={{ flex: 1 }}>
        {title}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          height: 32,
          borderRadius: 16,
          backgroundColor: accent.soft,
        }}
      >
        <Icon name="credit" size={13} color={accent.solid} weight="fill" />
        <Text color={accent.deep} weight="700" style={{ fontSize: 13 }}>
          {credits.toLocaleString()}
        </Text>
      </View>
      <RoundButton icon="close" label={closeLabel} onPress={onClose} />
    </HStack>
  );
}
