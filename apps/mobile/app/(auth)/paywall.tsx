/**
 * Paywall — RevenueCat-backed subscription screen.
 *
 * Data sources:
 *   - RevenueCat `offerings.current` → the purchasable packages + the
 *     store-localised price (`priceString`). This is the source of truth
 *     for what can be bought and at what price.
 *   - `GET /v1/store` → our DB catalog, used only to show how many credits
 *     each plan grants (matched to a package by store product id).
 *
 * Purchase flow: `purchasePackage()` → on success we invalidate `/me` so the
 * server-authoritative credits/entitlement refresh (the RevenueCat webhook
 * grants them backend-side; `RevenueCatBridge` also refreshes on the
 * customer-info change). Cancellation is a no-op (not an error).
 *
 * Compliance (App Store 3.1.1 / 3.1.2): every plan shows price + term, the
 * sticky footer carries auto-renew disclosure text + Terms/Privacy links,
 * and a Restore Purchases action is always available.
 *
 * Graceful states: if RevenueCat isn't configured yet (keys not set) or the
 * offering is empty, the screen shows an "unavailable" message instead of
 * crashing — it never blocks the user from closing.
 */

import { Button, HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui/Icon';
import {
  getCurrentOffering,
  isRevenueCatReady,
  purchasePackage,
  restorePurchases,
  type PurchasesPackage,
} from '@/lib/revenuecat';
import { getSDK } from '@/lib/sdk';
import { ME_QUERY_KEY, useSession } from '@/lib/use-session';

const PERKS: { icon: IconName; key: string }[] = [
  { icon: 'wand', key: 'templates' },
  { icon: 'video', key: 'video' },
  { icon: 'imageStack', key: 'multiImage' },
  { icon: 'download', key: 'downloads' },
];

/** Map RevenueCat package types to our i18n label + per-period suffix. */
const PERIOD: Record<string, { labelKey: string; perKey: string }> = {
  WEEKLY: { labelKey: 'plans.weekly', perKey: 'plans.perWeek' },
  MONTHLY: { labelKey: 'plans.monthly', perKey: 'plans.perMonth' },
  ANNUAL: { labelKey: 'plans.annual', perKey: 'plans.perYear' },
};

export default function PaywallScreen() {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation('paywall');
  const queryClient = useQueryClient();
  const { meQuery } = useSession();

  // RevenueCat offering (packages + localised prices).
  const offeringQuery = useQuery({
    queryKey: ['revenuecat', 'offering'],
    queryFn: getCurrentOffering,
    enabled: isRevenueCatReady(),
    staleTime: 5 * 60_000,
  });
  // DB catalog — only for the "N credits included" line per plan.
  const catalogQuery = useQuery({
    queryKey: ['store', 'catalog'],
    queryFn: () => getSDK().store.getCatalog(),
    staleTime: 5 * 60_000,
  });

  // Memoised: a fresh array on every render made the default-selection
  // effect below re-run on every render too.
  const packages = useMemo(
    () => offeringQuery.data?.availablePackages ?? [],
    [offeringQuery.data?.availablePackages],
  );
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Annual is pre-selected (best value), else monthly, else the first.
  // DERIVED rather than written by an effect: `null` means "the user has
  // not picked yet", so a refetch can no longer overwrite a real choice.
  const defaultId = useMemo(() => {
    const preferred =
      packages.find((p) => p.packageType === 'ANNUAL') ??
      packages.find((p) => p.packageType === 'MONTHLY') ??
      packages[0];
    return preferred?.identifier ?? null;
  }, [packages]);

  const selectedId = chosenId ?? defaultId;

  const creditsFor = (storeProductId: string): number | undefined =>
    catalogQuery.data?.subscriptions.find((s) => s.storeProductId === storeProductId)
      ?.creditsPerPeriod;

  const handleSubscribe = async () => {
    const pkg = packages.find((p) => p.identifier === selectedId);
    if (!pkg || purchasing) return;
    setPurchasing(true);
    // Pass the DB user id (never the Clerk-id fallback) so the purchase
    // self-heals RC identity — an anonymous-id purchase would be lost.
    const res = await purchasePackage(pkg, { dbUserId: meQuery.data?.id });
    setPurchasing(false);
    if (res.status === 'cancelled') return;
    if (res.status === 'error') {
      Alert.alert(t('errorTitle'), t('purchaseFailed'));
      return;
    }
    // Success — the webhook grants credits server-side; refresh /me so the
    // new balance + entitlement render, then return to the app.
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    router.replace('/(tabs)');
  };

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    const res = await restorePurchases();
    setRestoring(false);
    if (res.status === 'error') {
      Alert.alert(t('errorTitle'), t('purchaseFailed'));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    Alert.alert(t('restoredTitle'), t('restoredBody'));
  };

  const handleClose = () => router.replace('/(tabs)');

  const loading = offeringQuery.isLoading && isRevenueCatReady();
  const unavailable = !isRevenueCatReady() || (!loading && packages.length === 0);

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
          paddingBottom: 260,
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
                <Icon name={perk.icon} size={18} color={accent.deep} weight="fill" />
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

          {loading ? (
            <View style={{ paddingVertical: 32, alignItems: 'center' }}>
              <ActivityIndicator color={accent.solid} />
            </View>
          ) : unavailable ? (
            <View
              style={{
                padding: 16,
                borderRadius: 16,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text variant="body" color="inkMuted" align="center">
                {t('unavailable')}
              </Text>
            </View>
          ) : (
            packages.map((pkg) => (
              <PlanCard
                key={pkg.identifier}
                pkg={pkg}
                credits={creditsFor(pkg.product.identifier)}
                selected={selectedId === pkg.identifier}
                onSelect={() => setChosenId(pkg.identifier)}
              />
            ))
          )}
        </Stack>
      </ScrollView>

      {/* Sticky CTA + disclosures */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: insets.bottom + 12,
          backgroundColor: colors.bg,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          gap: 10,
        }}
      >
        <Button
          variant="accent"
          size="lg"
          full
          haptic="medium"
          loading={purchasing}
          disabled={unavailable || !selectedId || purchasing}
          onPress={handleSubscribe}
        >
          {t('cta.subscribe')}
        </Button>

        {/* Auto-renew disclosure (App Store 3.1.2) */}
        <Text variant="caption" color="inkSubtle" align="center" style={{ lineHeight: 16 }}>
          {t('cta.autoRenew')}
        </Text>

        {/* Restore + legal links */}
        <HStack align="center" justify="center" gap="md">
          <Pressable onPress={handleRestore} haptic="light" disabled={restoring}>
            <Text variant="caption" color="inkMuted" weight="600">
              {restoring ? t('restoring') : t('restore')}
            </Text>
          </Pressable>
          <Text variant="caption" color="inkSubtle">
            ·
          </Text>
          <Pressable onPress={() => router.push('/legal/terms')} haptic="light">
            <Text variant="caption" color="inkMuted" weight="600">
              {t('terms')}
            </Text>
          </Pressable>
          <Text variant="caption" color="inkSubtle">
            ·
          </Text>
          <Pressable onPress={() => router.push('/legal/privacy')} haptic="light">
            <Text variant="caption" color="inkMuted" weight="600">
              {t('privacy')}
            </Text>
          </Pressable>
        </HStack>
      </View>
    </View>
  );
}

function PlanCard({
  pkg,
  credits,
  selected,
  onSelect,
}: {
  pkg: PurchasesPackage;
  credits: number | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const { colors, accent } = useTheme();
  const { t } = useTranslation('paywall');

  const period = PERIOD[pkg.packageType];
  const label = period ? t(period.labelKey) : pkg.product.title;
  const per = period ? t(period.perKey) : '';
  const isAnnual = pkg.packageType === 'ANNUAL';

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
              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: accent.solid }}
            />
          ) : null}
        </View>

        <Stack gap="xs" style={{ flex: 1 }}>
          <HStack align="center" gap="sm">
            <Text variant="bodySemi" color={selected ? accent.deep : 'ink'}>
              {label}
            </Text>
            {isAnnual ? (
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
          {credits !== undefined ? (
            <Text variant="caption" color="inkMuted">
              {t('plans.creditsIncluded', {
                count: credits,
                formatted: credits.toLocaleString(),
              })}
            </Text>
          ) : null}
        </Stack>

        <Stack align="flex-end" gap="xs">
          <HStack align="baseline" gap="xs">
            <Text
              variant="mono"
              color={selected ? accent.deep : 'ink'}
              weight="700"
              style={{ fontSize: 18 }}
            >
              {pkg.product.priceString}
            </Text>
            {per ? (
              <Text variant="caption" color="inkMuted">
                {per}
              </Text>
            ) : null}
          </HStack>
        </Stack>
      </View>
    </Pressable>
  );
}
