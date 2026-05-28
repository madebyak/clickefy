import { Box, Skeleton, Stack, Text, useTheme } from '@clickfy/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bento } from '@/components/home/Bento';
import { CategoryRail } from '@/components/home/CategoryRail';
import { HomeBanner } from '@/components/home/HomeBanner';
import { SearchBar } from '@/components/home/SearchBar';
import { SectionHeader } from '@/components/home/SectionHeader';
import { TemplateCard } from '@/components/home/TemplateCard';
import { TopBar } from '@/components/home/TopBar';
import { CATEGORIES_QUERY, HOME_SECTIONS_QUERY } from '@/lib/query-config';
import { getSDK } from '@/lib/sdk';
import { useSession } from '@/lib/use-session';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const sdk = getSDK();
  const [activeCat, setActiveCat] = useState('all');

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => sdk.catalog.listCategories(),
    ...CATEGORIES_QUERY,
  });

  const sectionsQuery = useQuery({
    queryKey: ['home-sections', activeCat],
    queryFn: () => sdk.catalog.getHomeSections({ categoryId: activeCat }),
    ...HOME_SECTIONS_QUERY,
  });

  // Banner strip — same edge-cache window as sections (`s-maxage=60`).
  // We don't scope by category: banners are global. Failing the fetch
  // is silent — an empty list just hides the banner, the rest of the
  // home keeps working.
  const bannersQuery = useQuery({
    queryKey: ['home-banners'],
    queryFn: () => sdk.catalog.listBanners(),
    ...HOME_SECTIONS_QUERY,
  });

  const { plan } = useSession();

  const refreshing =
    categoriesQuery.isFetching || sectionsQuery.isFetching || bannersQuery.isFetching;
  const onRefresh = () => {
    void categoriesQuery.refetch();
    void sectionsQuery.refetch();
    void bannersQuery.refetch();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        credits={plan?.credits ?? 0}
        plan={plan?.tier ?? 'Free'}
        onMenu={() => router.push('/drawer')}
        onCreditsPress={() => router.push('/paywall')}
      />

      <Box px="base" pb="md">
        <SearchBar onPress={() => router.push('/search')} />
      </Box>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.inkMuted}
          />
        }
      >
        <Box pb="xxl">
          {/* The rail prepends its own "All" chip and copes with empty
              arrays gracefully — render it eagerly so something usable
              shows up even while categories are mid-fetch. */}
          <CategoryRail
            categories={categoriesQuery.data ?? []}
            activeId={activeCat}
            onSelect={setActiveCat}
          />
        </Box>

        {/* Banner strip — admin-curated, sits between the category rail
            and the section list. We render each active banner in
            sort_order. A `gap` between consecutive banners keeps the
            visual rhythm matching the rails below; a single banner
            (the common case) just sits on its own with the same
            bottom margin as a normal section. */}
        {(bannersQuery.data ?? []).length > 0 ? (
          <Box pb="xxl">
            {(bannersQuery.data ?? []).map((banner, i) => (
              <Box key={banner.id} pt={i === 0 ? undefined : 'md'}>
                <HomeBanner banner={banner} />
              </Box>
            ))}
          </Box>
        ) : null}

        {sectionsQuery.isLoading ? (
          <SectionLoadingSkeleton />
        ) : sectionsQuery.isError ? (
          <Box px="lg">
            <Text variant="body" color="danger">
              Couldn&apos;t load templates. Pull down to try again.
            </Text>
          </Box>
        ) : (
          (sectionsQuery.data ?? []).map((section) => (
            <Box key={section.key} pb="xxl">
              {/* "See all" → /section/[key]. We forward the title via
                  query param so the destination header renders without
                  an extra fetch. The route falls back to a per-key
                  default title if the param is missing or stale. */}
              <SectionHeader
                title={section.title}
                subtitle={section.subtitle}
                onAction={() =>
                  router.push({
                    pathname: '/section/[key]',
                    params: { key: section.key, title: section.title },
                  })
                }
              />
              {section.layout === 'bento' ? (
                <Bento templates={section.templates} />
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
                >
                  {section.templates.map((tpl) => (
                    <View key={tpl.id} style={{ width: 200 }}>
                      <TemplateCard template={tpl} />
                    </View>
                  ))}
                </ScrollView>
              )}
            </Box>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function SectionLoadingSkeleton() {
  return (
    <Stack px="lg" gap="lg" pb="xxl">
      <Skeleton height={20} width={160} />
      <Skeleton height={220} radius={18} />
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <View style={{ flex: 1 }}>
          <Skeleton height={180} radius={18} />
        </View>
        <View style={{ flex: 1 }}>
          <Skeleton height={180} radius={18} />
        </View>
      </View>
    </Stack>
  );
}
