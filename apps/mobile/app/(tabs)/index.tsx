import { Box, Skeleton, Stack, Text, useTheme } from '@clickfy/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bento } from '@/components/home/Bento';
import { CategoryGrid } from '@/components/home/CategoryGrid';
import { CategoryRail } from '@/components/home/CategoryRail';
import { HomeBannerSlider } from '@/components/home/HomeBanner';
import { SearchBar } from '@/components/home/SearchBar';
import { SectionHeader } from '@/components/home/SectionHeader';
import { SubcategoryRail } from '@/components/home/SubcategoryRail';
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
  // `activeCat` always tracks the ROOT category id (or the synthetic
  // 'all'). When a root has sub-categories, `activeSubcategoryId` is
  // the narrower selection within that root (null = "All <Parent>",
  // i.e. aggregate the parent + every child). Splitting the two
  // pieces of state keeps the rail components stateless and lets us
  // restore the previous sub when the user comes back to a root.
  const [activeCat, setActiveCat] = useState('all');
  const [activeSubcategoryId, setActiveSubcategoryId] = useState<string | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => sdk.catalog.listCategories(),
    ...CATEGORIES_QUERY,
  });

  const isAllCategory = activeCat === 'all';

  // Resolve the currently-selected root from the categories response
  // so we can decide whether to show the SubcategoryRail and which
  // children to feed it.
  const activeRoot = !isAllCategory
    ? (categoriesQuery.data ?? []).find((c) => c.id === activeCat && !c.parentId)
    : undefined;
  const activeRootChildren = activeRoot?.children ?? [];
  const hasSubcategories = activeRootChildren.length > 0;

  // The id we hand to <CategoryGrid /> — narrowed to the picked
  // child when the user has chosen one, otherwise the root (which
  // the API aggregates to include all children's templates).
  const gridCategoryId = activeSubcategoryId ?? activeCat;

  // Reset the sub selection whenever the root changes so picking
  // Beauty → Perfumes → Lifestyle doesn't keep "Perfumes" highlighted
  // under the wrong parent.
  const handleSelectRoot = (id: string) => {
    setActiveCat(id);
    setActiveSubcategoryId(null);
  };

  // ── Deep-link from banner CTAs ───────────────────────────────────
  // `router.push({ pathname: '/', params: { categoryId } })` from
  // <HomeBanner /> lands here. We resolve the id against the cached
  // categories list and seed activeCat (+ activeSubcategoryId for
  // child ids). The param is cleared after consumption so back-stack
  // navigation doesn't keep re-seeding the same selection on each
  // remount.
  const { categoryId: deepLinkCategoryId } = useLocalSearchParams<{
    categoryId?: string;
  }>();
  useEffect(() => {
    if (!deepLinkCategoryId) return;
    const cats = categoriesQuery.data;
    if (!cats || cats.length === 0) return; // wait for the list

    const target = cats.find((c) => c.id === deepLinkCategoryId);
    if (!target) {
      // Unknown id (e.g. category got deleted after the banner was
      // authored). Reset to "All" so the user sees something useful
      // instead of an empty grid.
      setActiveCat('all');
      setActiveSubcategoryId(null);
    } else if (target.parentId) {
      // Sub-category → select its parent root and highlight the sub.
      setActiveCat(target.parentId);
      setActiveSubcategoryId(target.id);
    } else {
      // Root → select it and clear any sub selection.
      setActiveCat(target.id);
      setActiveSubcategoryId(null);
    }
    // Strip the param so a subsequent root tap in the rail isn't
    // overridden by the stale deep-link on a re-render.
    router.setParams({ categoryId: undefined });
  }, [deepLinkCategoryId, categoriesQuery.data, router]);

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

      {/* Scope-aware search entry. When the user has chosen a category
          (or a sub-category) we forward both the id and a human label
          to `/search` so it pre-seeds the filter store and renders an
          "In <label> ✕" chip. Tapping ✕ inside `/search` clears the
          scope back to a global search — Etsy / App Store pattern. */}
      {(() => {
        const activeChild = activeSubcategoryId
          ? activeRootChildren.find((c) => c.id === activeSubcategoryId)
          : undefined;
        const scopeId = !isAllCategory ? gridCategoryId : undefined;
        const scopeLabel = activeChild?.label ?? activeRoot?.label;
        return (
          <Box px="base" pb="md">
            <SearchBar
              scopeLabel={scopeLabel}
              onPress={() =>
                router.push({
                  pathname: '/search',
                  params: scopeId
                    ? { categoryId: scopeId, scopeLabel: scopeLabel ?? '' }
                    : {},
                })
              }
            />
          </Box>
        );
      })()}

      {/* Category rail is always pinned below the search bar so the
          user can switch between "All" (sections feed) and a single
          category (flat grid) at any time without scrolling back up. */}
      <Box pb="md">
        <CategoryRail
          categories={categoriesQuery.data ?? []}
          activeId={activeCat}
          onSelect={handleSelectRoot}
        />
      </Box>

      {/* SubcategoryRail only renders when the selected root has
          children — keeps the home view chrome-free for roots like
          "Product" that don't (yet) have sub-categories. */}
      {!isAllCategory && hasSubcategories && activeRoot ? (
        <Box pb="md">
          <SubcategoryRail
            parent={activeRoot}
            subcategories={activeRootChildren}
            activeChildId={activeSubcategoryId}
            onSelect={setActiveSubcategoryId}
          />
        </Box>
      ) : null}

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
        // No banners, no "See all" chevrons — just templates. When a
        // sub-category is picked we narrow to it; otherwise we feed
        // the root id which the API expands to root + every child.
        <CategoryGrid categoryId={gridCategoryId} />
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
