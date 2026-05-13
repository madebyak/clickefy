import { HStack, Pressable, Text, useTheme } from '@clickfy/ui';
import { Pressable as RNPressable, View } from 'react-native';

import { Logo } from '@/components/brand/Logo';
import { Icon } from '@/components/ui/Icon';

export interface TopBarProps {
  credits: number;
  plan: string;
  onMenu?: () => void;
  onProfile?: () => void;
}

/**
 * Top bar — three regions:
 *   [hamburger] [wordmark]            [credits pill]
 *   ↑ left-aligned cluster            ↑ right-aligned
 *
 * The credits pill is a single unified surface containing:
 *   accent dot · credits number · vertical divider · plan label
 * No nested badges — keeps heights stable and visually clean.
 */
export function TopBar({ credits, plan, onMenu, onProfile }: TopBarProps) {
  const { colors, accent } = useTheme();

  return (
    <HStack px="base" py="sm" align="center" justify="space-between" gap="md">
      {/* Left cluster: hamburger + wordmark */}
      <HStack align="center" gap="md" style={{ flex: 1 }}>
        <Pressable
          onPress={onMenu}
          haptic="light"
          accessibilityLabel="Open menu"
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="menu" size={20} color={colors.ink} weight="bold" />
        </Pressable>

        {/* Brand mark — the official SVG logo (the violet ".Ai" replaces the
            old accent-dot affordance, baked into the artwork). */}
        <Logo width={108} />
      </HStack>

      {/* Right: unified credits + plan pill */}
      <RNPressable
        onPress={onProfile}
        accessibilityLabel={`${plan} plan, ${credits} credits`}
        accessibilityRole="button"
        style={({ pressed }) => ({
          height: 36,
          paddingHorizontal: 12,
          borderRadius: 18,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: accent.solid,
            shadowColor: accent.solid,
            shadowOpacity: 0.6,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 0 },
          }}
        />
        <Text variant="mono" color="ink" weight="700" style={{ fontSize: 13 }}>
          {credits}
        </Text>
        <View
          style={{
            width: 1,
            height: 14,
            backgroundColor: colors.border,
          }}
        />
        <Text
          color="inkMuted"
          weight="700"
          transform="uppercase"
          style={{ fontSize: 10.5, letterSpacing: 0.6, lineHeight: 12 }}
        >
          {plan}
        </Text>
      </RNPressable>
    </HStack>
  );
}
