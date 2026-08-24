/**
 * Buy Credits — one-off top-up packs (consumables).
 *
 * Credits from a top-up pack are spendable only while the user has an active
 * subscription (see the credit-bucket rules), so the server gates the pack
 * list behind an active plan: `GET /v1/store` returns `topupsLocked: true`
 * and no packs for free users. This screen mirrors that:
 *   - not subscribed  → a "packs are a Pro perk" card that routes to the paywall
 *   - subscribed      → the purchasable packs
 *
 * Packs come from RevenueCat (price via `priceString`, purchase via
 * `purchasePackage`) matched to our DB catalog by store product id (which
 * supplies the credit amount). A purchase fires the `NON_RENEWING_PURCHASE`
 * webhook → the backend grants credits → we refresh `/me`.
 */

import { Button, HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import type { StoreCreditPack } from '@clickfy/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import {
  getCurrentOffering,
  isRevenueCatReady,
  purchasePackage,
  restorePurchases,
  type PurchasesPackage,
} from '@/lib/revenuecat';
import { getSDK } from '@/lib/sdk';
import { ME_QUERY_KEY, useSession } from '@/lib/use-session';

interface PackRow {
  pack: StoreCreditPack;
  pkg: PurchasesPackage;
}

export default function BuyCreditsScreen() {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation('paywall');
  const queryClient = useQueryClient();
  const { plan, meQuery } = useSession();

  const catalogQuery = useQuery({
    queryKey: ['store', 'catalog'],
    queryFn: () => getSDK().store.getCatalog(),
    staleTime: 5 * 60_000,
  });
  const offeringQuery = useQuery({
    queryKey: ['revenuecat', 'offering'],
    queryFn: getCurrentOffering,
    enabled: isRevenueCatReady(),
    staleTime: 5 * 60_000,
  });

  const catalog = catalogQuery.data;
  // Memoised for the same reason `packRows` below is: a fresh array every
  // render would defeat that memo entirely.
  const packages = useMemo(
    () => offeringQuery.data?.availablePackages ?? [],
    [offeringQuery.data?.availablePackages],
  );

  // Match each DB credit-pack to its RevenueCat package by store product id.
  // The DB is the source of truth for "this product is a credit pack" (+ how
  // many credits it grants); RevenueCat supplies the localised price.
  //
  // Memoised because this array fed an effect: rebuilt on every render, it
  // re-ran that effect on every render too.
  const packRows: PackRow[] = useMemo(() => {
    const rows: PackRow[] = [];
    for (const pack of catalog?.packs ?? []) {
      const pkg = packages.find((p) => p.product.identifier === pack.storeProductId);
      if (pkg) rows.push({ pack, pkg });
    }
    return rows;
  }, [catalog?.packs, packages]);

  // `null` means "the user has not picked yet", so the default is DERIVED
  // rather than written by an effect. The effect version needed a
  // `!selectedId` guard to avoid overwriting the user's choice every time
  // the catalogue refetched; deriving it removes the failure mode instead
  // of guarding against it.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const defaultId = useMemo(() => {
    const featured = packRows.find((r) => r.pack.isFeatured) ?? packRows[0];
    return featured?.pkg.identifier ?? null;
  }, [packRows]);

  const selectedId = chosenId ?? defaultId;

  const handleBuy = async () => {
    const row = packRows.find((r) => r.pkg.identifier === selectedId);
    if (!row || purchasing) return;
    setPurchasing(true);
    // Pass the DB user id (never the Clerk-id fallback) so the purchase
    // self-heals RC identity — an anonymous-id purchase would be lost.
    const res = await purchasePackage(row.pkg, { dbUserId: meQuery.data?.id });
    setPurchasing(false);
    if (res.status === 'cancelled') return;
    if (res.status === 'error') {
      Alert.alert(t('errorTitle'), t('purchaseFailed'));
      return;
    }
    // The webhook grants the credits server-side; refresh /me so the new
    // balance lands. There can be a brief delay while the webhook processes.
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    Alert.alert(t('credits.purchasedTitle'), t('credits.purchasedBody'));
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

  const loading = catalogQuery.isLoading || (offeringQuery.isLoading && isRevenueCatReady());
  const locked = catalog?.topupsLocked ?? true;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Close */}
      <View style={{ position: 'absolute', top: insets.top + 8, end: 16, zIndex: 20 }}>
        <Pressable
          onPress={() => router.back()}
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
          paddingBottom: packRows.length > 0 && !locked ? 220 : 40,
          gap: 24,
        }}
      >
        {/* Title */}
        <Stack gap="xs">
          <Text variant="title" color="ink" style={{ fontSize: 32, lineHeight: 36 }}>
            {t('credits.title')}
          </Text>
        </Stack>

        {/* Balance */}
        <View
          style={{
            padding: 18,
            borderRadius: 20,
            backgroundColor: accent.soft,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: accent.solid,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="credit" size={20} color={accent.ink} weight="fill" />
          </View>
          <Stack gap="xs" style={{ flex: 1 }}>
            <Text variant="caption" color="inkMuted">
              {t('credits.balance')}
            </Text>
            <Text variant="heading" color={accent.deep}>
              {t('credits.creditsUnit', {
                count: plan?.credits ?? 0,
                formatted: (plan?.credits ?? 0).toLocaleString(),
              })}
            </Text>
          </Stack>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 32, alignItems: 'center' }}>
            <ActivityIndicator color={accent.solid} />
          </View>
        ) : locked ? (
          <View
            style={{
              padding: 20,
              borderRadius: 20,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              gap: 12,
            }}
          >
            <Icon name="sparkle" size={22} color={accent.solid} weight="fill" />
            <Text variant="subhead" color="ink">
              {t('credits.lockedTitle')}
            </Text>
            <Text variant="body" color="inkMuted" style={{ lineHeight: 22 }}>
              {t('credits.lockedBody')}
            </Text>
            <Button
              variant="accent"
              size="lg"
              full
              haptic="medium"
              onPress={() => router.replace('/paywall')}
            >
              {t('credits.lockedCta')}
            </Button>
          </View>
        ) : packRows.length === 0 ? (
          <View
            style={{
              padding: 18,
              borderRadius: 16,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text variant="body" color="inkMuted" align="center">
              {t('credits.emptyBody')}
            </Text>
          </View>
        ) : (
          <Stack gap="sm">
            {packRows.map(({ pack, pkg }) => {
              const total = pack.credits + pack.bonusCredits;
              const selected = selectedId === pkg.identifier;
              return (
                <Pressable
                  key={pkg.identifier}
                  onPress={() => setChosenId(pkg.identifier)}
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
                          {t('credits.creditsUnit', {
                            count: total,
                            formatted: total.toLocaleString(),
                          })}
                        </Text>
                        {pack.bonusCredits > 0 ? (
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
                              {t('credits.bonus', { count: pack.bonusCredits })}
                            </Text>
                          </View>
                        ) : null}
                      </HStack>
                      <Text variant="caption" color="inkMuted">
                        {pack.displayName}
                      </Text>
                    </Stack>

                    <Text
                      variant="mono"
                      color={selected ? accent.deep : 'ink'}
                      weight="700"
                      style={{ fontSize: 18 }}
                    >
                      {pkg.product.priceString}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Stack>
        )}
      </ScrollView>

      {/* Sticky CTA — only when there are purchasable packs */}
      {!loading && !locked && packRows.length > 0 ? (
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
            disabled={!selectedId || purchasing}
            onPress={handleBuy}
          >
            {t('credits.buy')}
          </Button>
          <Text variant="caption" color="inkSubtle" align="center" style={{ lineHeight: 16 }}>
            {t('credits.neverExpire')}
          </Text>
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
          </HStack>
        </View>
      ) : null}
    </View>
  );
}
