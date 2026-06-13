import { Button, HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui/Icon';

interface Plan {
  id: 'monthly' | 'annual' | 'lifetime';
  /** Whether to render the "best value" badge. */
  badge?: boolean;
  priceLabel: string;
  /** i18n key (under `plans`) for the price suffix label. */
  perKey?: 'perMonth' | 'perYear' | 'oneTime';
  /** Cross-out previous price */
  strike?: string;
  credits: number;
  highlighted?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'monthly',
    priceLabel: '$19',
    perKey: 'perMonth',
    credits: 250,
  },
  {
    id: 'annual',
    badge: true,
    priceLabel: '$129',
    perKey: 'perYear',
    strike: '$228',
    credits: 3000,
    highlighted: true,
  },
  {
    id: 'lifetime',
    priceLabel: '$299',
    perKey: 'oneTime',
    credits: 5000,
  },
];

const PERKS: { icon: IconName; key: string }[] = [
  { icon: 'wand', key: 'templates' },
  { icon: 'video', key: 'video' },
  { icon: 'imageStack', key: 'multiImage' },
  { icon: 'download', key: 'downloads' },
];

export default function PaywallScreen() {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation('paywall');
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
      <View style={{ position: 'absolute', top: insets.top + 8, end: 16, zIndex: 20 }}>
        <Pressable
          onPress={handleClose}
          haptic="light"
          accessibilityLabel={t('close')}
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
              {t('eyebrow')}
            </Text>
          </HStack>
          <Text variant="display" color="ink" italic style={{ fontSize: 40, lineHeight: 44 }}>
            {t('headlineLine1')}
          </Text>
          <Text variant="display" color="ink" italic style={{ fontSize: 40, lineHeight: 44 }}>
            {t('headlineLine2')}
          </Text>
        </Stack>

        {/* Perks */}
        <Stack gap="md">
          {PERKS.map((perk) => (
            <HStack key={perk.key} align="center" gap="md">
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
                  {t(`perks.${perk.key}.title`)}
                </Text>
                <Text variant="caption" color="inkMuted">
                  {t(`perks.${perk.key}.subtitle`)}
                </Text>
              </Stack>
            </HStack>
          ))}
        </Stack>

        {/* Plans */}
        <Stack gap="sm">
          <Text variant="overline" color="inkMuted" transform="uppercase">
            {t('chooseYourPlan')}
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
          {t('cta.startTrial')}
        </Button>
        <Text variant="caption" color="inkSubtle" align="center">
          {t('cta.fineprint')}
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
  const { t } = useTranslation('paywall');
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
              {t(`plans.${plan.id}`)}
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
                  {t('plans.bestValue')}
                </Text>
              </View>
            ) : null}
          </HStack>
          <Text variant="caption" color="inkMuted">
            {t('plans.creditsIncluded', {
              count: plan.credits,
              formatted: plan.credits.toLocaleString(),
            })}
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
            {plan.perKey ? (
              <Text variant="caption" color="inkMuted">
                {t(`plans.${plan.perKey}`)}
              </Text>
            ) : null}
          </HStack>
        </Stack>
      </View>
    </Pressable>
  );
}
