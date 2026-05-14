import { Button, HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui/Icon';

interface Plan {
  id: 'monthly' | 'annual' | 'lifetime';
  badge?: string;
  title: string;
  priceLabel: string;
  perLabel?: string;
  /** Cross-out previous price */
  strike?: string;
  credits: number;
  highlighted?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'monthly',
    title: 'Monthly',
    priceLabel: '$19',
    perLabel: '/ month',
    credits: 250,
  },
  {
    id: 'annual',
    badge: 'Best value',
    title: 'Annual',
    priceLabel: '$129',
    perLabel: '/ year',
    strike: '$228',
    credits: 3000,
    highlighted: true,
  },
  {
    id: 'lifetime',
    title: 'Lifetime',
    priceLabel: '$299',
    perLabel: 'one-time',
    credits: 5000,
  },
];

const PERKS: { icon: IconName; title: string; subtitle: string }[] = [
  { icon: 'wand', title: 'Unlimited templates', subtitle: 'Every studio + premium template' },
  { icon: 'video', title: 'Video generations', subtitle: '4K motion clips up to 8s' },
  { icon: 'imageStack', title: 'Multi-image sets', subtitle: 'Carousels & lookbooks in one tap' },
  { icon: 'download', title: 'High-res downloads', subtitle: 'Export PNG / MP4 with zero watermark' },
];

export default function PaywallScreen() {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selected, setSelected] = useState<Plan['id']>('annual');

  const handleStartTrial = () => {
    // TODO: hook to RevenueCat purchase flow in Phase 2.
    router.replace('/(tabs)');
  };

  const handleClose = () => {
    router.replace('/(tabs)');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Close button */}
      <View style={{ position: 'absolute', top: insets.top + 8, right: 16, zIndex: 20 }}>
        <Pressable
          onPress={handleClose}
          haptic="light"
          accessibilityLabel="Close paywall"
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="close" size={14} color={colors.ink} weight="bold" />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 60,
          paddingHorizontal: 24,
          paddingBottom: 220,
          gap: 28,
        }}
      >
        {/* Headline */}
        <Stack gap="sm">
          <HStack align="center" gap="xs">
            <Icon name="sparkle" size={18} color={accent.solid} weight="fill" />
            <Text
              color={accent.solid}
              weight="700"
              transform="uppercase"
              style={{ fontSize: 11.5, letterSpacing: 1.4 }}
            >
              Clickefy Pro
            </Text>
          </HStack>
          <Text variant="display" color="ink" italic style={{ fontSize: 40, lineHeight: 44 }}>
            Make every shot
          </Text>
          <Text variant="display" color="ink" italic style={{ fontSize: 40, lineHeight: 44 }}>
            scroll-stopping.
          </Text>
        </Stack>

        {/* Perks */}
        <Stack gap="md">
          {PERKS.map((perk) => (
            <HStack key={perk.title} align="center" gap="md">
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: accent.soft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon
                  name={perk.icon}
                  size={18}
                  color={accent.deep}
                  weight="fill"
                />
              </View>
              <Stack gap="xs" style={{ flex: 1 }}>
                <Text variant="bodySemi" color="ink">
                  {perk.title}
                </Text>
                <Text variant="caption" color="inkMuted">
                  {perk.subtitle}
                </Text>
              </Stack>
            </HStack>
          ))}
        </Stack>

        {/* Plans */}
        <Stack gap="sm">
          <Text variant="overline" color="inkMuted" transform="uppercase">
            Choose your plan
          </Text>
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              selected={selected === plan.id}
              onSelect={() => setSelected(plan.id)}
            />
          ))}
        </Stack>
      </ScrollView>

      {/* Sticky CTA */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: insets.bottom + 16,
          backgroundColor: colors.bg,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          gap: 8,
        }}
      >
        <Button variant="accent" size="lg" full haptic="medium" onPress={handleStartTrial}>
          Start 7-day free trial
        </Button>
        <Text variant="caption" color="inkSubtle" align="center">
          Cancel anytime · No charge during trial
        </Text>
      </View>
    </View>
  );
}

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
}) {
  const { colors, accent } = useTheme();
  return (
    <Pressable
      onPress={onSelect}
      haptic="selection"
      pressedOpacity={0.92}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View
        style={{
          padding: 16,
          borderRadius: 18,
          backgroundColor: selected ? accent.soft : colors.surface,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? accent.solid : colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {/* Radio */}
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: 2,
            borderColor: selected ? accent.solid : colors.borderStrong,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? (
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: accent.solid,
              }}
            />
          ) : null}
        </View>

        <Stack gap="xs" style={{ flex: 1 }}>
          <HStack align="center" gap="sm">
            <Text variant="bodySemi" color={selected ? accent.deep : 'ink'}>
              {plan.title}
            </Text>
            {plan.badge ? (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 8,
                  backgroundColor: accent.solid,
                }}
              >
                <Text
                  color={accent.ink}
                  weight="700"
                  transform="uppercase"
                  style={{ fontSize: 10, letterSpacing: 0.6 }}
                >
                  {plan.badge}
                </Text>
              </View>
            ) : null}
          </HStack>
          <Text variant="caption" color="inkMuted">
            {plan.credits.toLocaleString()} credits included
          </Text>
        </Stack>

        <Stack align="flex-end" gap="xs">
          {plan.strike ? (
            <Text
              variant="caption"
              color="inkSubtle"
              style={{ textDecorationLine: 'line-through' }}
            >
              {plan.strike}
            </Text>
          ) : null}
          <HStack align="baseline" gap="xs">
            <Text variant="mono" color={selected ? accent.deep : 'ink'} weight="700" style={{ fontSize: 18 }}>
              {plan.priceLabel}
            </Text>
            {plan.perLabel ? (
              <Text variant="caption" color="inkMuted">
                {plan.perLabel}
              </Text>
            ) : null}
          </HStack>
        </Stack>
      </View>
    </Pressable>
  );
}
