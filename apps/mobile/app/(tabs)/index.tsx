import { Box, Skeleton, Stack, Text, useTheme } from '@clickfy/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bento } from '@/components/home/Bento';
import { CategoryGrid } from '@/components/home/CategoryGrid';
import { CategoryRail } from '@/components/home/CategoryRail';
import { HomeBannerSlider } from '@/components/home/HomeBanner';
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

  const isAllCategory = activeCat === 'all';

  // Sections + banners only matter on the "All" feed. When the user
  // taps a specific category we render a flat 2-column grid (see
  // <CategoryGrid />) and skip these queries entirely so we don't
  // burn a network round-trip on data we won't display.
  const sectionsQuery = useQuery({
    queryKey: ['home-sections', activeCat],
    queryFn: () => sdk.catalog.getHomeSections({ categoryId: activeCat }),
    enabled: isAllCategory,
    ...HOME_SECTIONS_QUERY,
  });

  const bannersQuery = useQuery({
    queryKey: ['home-banners'],
    queryFn: () => sdk.catalog.listBanners(),
    enabled: isAllCategory,
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

      {/* Category rail is always pinned below the search bar so the
          user can switch between "All" (sections feed) and a single
          category (flat grid) at any time without scrolling back up. */}
      <Box pb="md">
        <CategoryRail
          categories={categoriesQuery.data ?? []}
          activeId={activeCat}
          onSelect={setActiveCat}
        />
      </Box>

      {isAllCategory ? (
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
          {/* Banner strip — admin-curated, sits between the category rail
              and the section list. One 16:9 slot; if the admin has
              multiple active banner rows, the slot becomes a horizontal
              pager (manual swipe + dots) ordered by sortOrder. Banners
              are global and only render on the "All" feed. */}
          {(bannersQuery.data ?? []).length > 0 ? (
            <Box pb="xxl">
              <HomeBannerSlider banners={bannersQuery.data ?? []} />
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
      ) : (
        // Category selected → flat 2-column infinite-scroll grid.
        // No rails, no banners, no "See all" chevrons — just templates.
        <CategoryGrid categoryId={activeCat} />
      )}
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
