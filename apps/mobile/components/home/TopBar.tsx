import { HStack, Pressable, Text, useTheme } from '@clickfy/ui';
import { useTranslation } from 'react-i18next';
import { Pressable as RNPressable, View } from 'react-native';

import { Logo } from '@/components/brand/Logo';
import { PlanLabel } from '@/components/shared/PlanLabel';
import { Icon } from '@/components/ui/Icon';

export interface TopBarProps {
  credits: number;
  plan: string;
  onMenu?: () => void;
  /**
   * Tap target on the credits/plan pill. Conventionally routes to the
   * paywall (subscription + top-up) since the pill is a "buy more" CTA
   * dressed up as a status indicator.
   */
  onCreditsPress?: () => void;
}

/**
 * Top bar — three regions:
 *   [hamburger] [wordmark]            [credits pill]
 *   ↑ left-aligned cluster            ↑ right-aligned
 *
 * The credits pill is a single unified surface containing:
 *   diamond credit icon · credits number · vertical divider · plan label
 * No nested badges — keeps heights stable and visually clean.
 */
export function TopBar({ credits, plan, onMenu, onCreditsPress }: TopBarProps) {
  const { colors, accent } = useTheme();
  const { t } = useTranslation('home');

  return (
    <HStack px="base" py="sm" align="center" justify="space-between" gap="md">
      {/* Left cluster: hamburger + wordmark */}
      <HStack align="center" gap="md" style={{ flex: 1 }}>
        <Pressable
          onPress={onMenu}
          haptic="light"
          accessibilityLabel={t('topBar.openMenu')}
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
        onPress={onCreditsPress}
        accessibilityLabel={t('topBar.creditsLabel', { plan, credits })}
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
        <Icon name="credit" size={14} color={accent.solid} weight="fill" />
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
        <PlanLabel plan={plan} />
      </RNPressable>
    </HStack>
  );
}
