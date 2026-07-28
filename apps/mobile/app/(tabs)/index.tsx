import { Box, Skeleton, Stack, Text, useTheme } from '@clickfy/ui';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshControl,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
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
import {
  countActiveFilters,
  setSearchFilters,
  useSearchFilters,
} from '@/lib/search-state';
import { useSession } from '@/lib/use-session';

// The four fixed discovery rails carry server-provided English titles that are
// actually system UI strings (see api/section-builder.ts). We localize them on
// the client by key. Category rails (key `category-<uuid>`) keep their dynamic,
// server-localized title.
const FIXED_SECTION_KEYS = new Set(['trending', 'new-arrivals', 'video-magic', 'photo-sets']);

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('home');
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
  // under the wrong parent. We also clear the toggled filter state
  // (`kind`, `featured`, `sort`) when the user switches roots — those
  // filters are scoped to a category surface, and carrying them over
  // surprises the user ("why is this category empty? oh, I had
  // 'Featured only' on from before"). The search query string (the
  // user's typed text) is *not* in this store, so we only nuke the
  // structured filter toggles.
  const handleSelectRoot = (id: string) => {
    setActiveCat(id);
    setActiveSubcategoryId(null);
    setSearchFilters({
      kind: undefined,
      featured: undefined,
      sort: 'default',
    });
  };

  // Active filter count drives the dot on the sliders icon. We read
  // the live store directly so any change inside `/search-filters`
  // reflects on the home bar the moment the user dismisses the sheet.
  const filters = useSearchFilters();
  const activeFilterCount = countActiveFilters(filters);

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

  // ── Collapsing category rail ─────────────────────────────────────
  // The rail hides when the feed scrolls down and slides back in on any
  // scroll-up (modern "shrinking header" UX). The per-frame animation
  // runs on the UI thread via Reanimated `withTiming`; the JS `onScroll`
  // only detects direction and flips a boolean — no per-frame JS work, so
  // it stays smooth even on a long feed.
  const [railHeight, setRailHeight] = useState(0);
  const railHeightRef = useRef(0);
  const railHeightSV = useSharedValue(0);
  const railTranslate = useSharedValue(0);
  const railHidden = useRef(false);
  const lastScrollY = useRef(0);

  const onRailLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0 && h !== railHeightRef.current) {
        railHeightRef.current = h;
        railHeightSV.value = h;
        setRailHeight(h);
      }
    },
    [railHeightSV],
  );

  const onFeedScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const dy = y - lastScrollY.current;
      lastScrollY.current = y;
      const h = railHeightRef.current;
      if (h <= 0) return;
      // Near the top → always fully show.
      if (y <= 4) {
        if (railHidden.current) {
          railHidden.current = false;
          railTranslate.value = withTiming(0, { duration: 220 });
        }
        return;
      }
      // Direction threshold avoids flip-flopping on tiny scroll jitters.
      if (dy > 6 && !railHidden.current) {
        railHidden.current = true;
        railTranslate.value = withTiming(-h, { duration: 220 });
      } else if (dy < -6 && railHidden.current) {
        railHidden.current = false;
        railTranslate.value = withTiming(0, { duration: 220 });
      }
    },
    [railTranslate],
  );

  const railStyle = useAnimatedStyle(() => {
    const h = railHeightSV.value || 1;
    const progress = Math.min(1, Math.abs(railTranslate.value) / h);
    return {
      transform: [{ translateY: railTranslate.value }],
      // Subtle fade so it dissolves rather than just clipping at the edge.
      opacity: 1 - progress * 0.2,
    };
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        credits={plan?.credits ?? 0}
        plan={plan?.tier ?? 'Free'}
        onMenu={() => router.push('/drawer')}
        onCreditsPress={() => router.push('/paywall')}
      />

      {/* Scope-aware search entry. Two affordances on one row:
            1. Tap the input → opens `/search` (typed query). When the
               user has a category selected we forward the id + label so
               `/search` pre-seeds the scope and renders an "In <Label> ✕"
               chip. Etsy / App Store pattern.
            2. Tap the sliders icon → opens `/search-filters` directly.
               Hidden entirely on the "All" feed since the curated rails
               aren't filterable; visible on the category-grid view so
               the user can re-sort / narrow by kind in place. The
               sheet's Apply commits to the shared filter store; the
               grid below re-fetches automatically.

          Honoring the rule that the home rails ("All") have no filter
          chrome at all keeps that surface calm and matches Pinterest /
          App Store / TikTok feed conventions. */}
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
              // Only attach the filter affordance on filterable
              // surfaces. `undefined` = hide the icon completely.
              onPressFilters={
                isAllCategory
                  ? undefined
                  : () =>
                      router.push({
                        pathname: '/search-filters',
                        // No `q` param here — the sheet's count
                        // preview falls back to "filters only" when
                        // there's no query, which is exactly what we
                        // want from the home category-grid surface.
                      })
              }
              activeFilterCount={isAllCategory ? 0 : activeFilterCount}
            />
          </Box>
        );
      })()}

      {isAllCategory ? (
        // Vertical feed is a FlashList (not a ScrollView) so off-screen
        // sections — and therefore their rails, cards, and any live video
        // decoders — unmount as the user scrolls. Combined with the global
        // play-slot cap in <VideoPreview />, this is what keeps the home
        // feed from exhausting the device's MediaCodec budget (the OOM /
        // overheating crashes). Banner lives in the header so it scrolls
        // with the list; loading/error render via ListEmptyComponent so
        // pull-to-refresh stays available in every state. The category
        // rail is an absolute overlay that hides on scroll-down and slides
        // back in on scroll-up; `overflow:'hidden'` clips it as it leaves.
        <View style={{ flex: 1, overflow: 'hidden' }}>
        <FlashList
          data={sectionsQuery.data ?? []}
          keyExtractor={(section) => section.key}
          renderItem={({ item: section }) => {
            // Localize the four fixed discovery rails by key; category rails
            // keep their server-provided (already locale-aware) title.
            const isFixed = FIXED_SECTION_KEYS.has(section.key);
            const localizedTitle = isFixed
              ? t(`sections.${section.key}.title`)
              : section.title;
            const localizedSubtitle = isFixed
              ? t(`sections.${section.key}.subtitle`)
              : section.subtitle;
            return (
            <Box pb="xxl" style={{ width: '100%' }}>
              {/* "See all" → /section/[key]. We forward the title via
                  query param so the destination header renders without
                  an extra fetch. The route falls back to a per-key
                  default title if the param is missing or stale. */}
              <SectionHeader
                title={localizedTitle}
                subtitle={localizedSubtitle}
                onAction={() =>
                  router.push({
                    pathname: '/section/[key]',
                    params: { key: section.key, title: localizedTitle },
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
            );
          }}
          /* Banner strip — admin-curated, sits between the category rail
             and the section list. One 16:9 slot; if the admin has multiple
             active banner rows, the slot becomes a horizontal pager
             (manual swipe + dots) ordered by sortOrder. Banners are global
             and only render on the "All" feed. */
          ListHeaderComponent={
            (bannersQuery.data ?? []).length > 0 ? (
              <Box pb="xxl">
                <HomeBannerSlider banners={bannersQuery.data ?? []} />
              </Box>
            ) : null
          }
          ListEmptyComponent={
            sectionsQuery.isLoading ? (
              <SectionLoadingSkeleton />
            ) : sectionsQuery.isError ? (
              <Box px="lg">
                <Text variant="body" color="danger">
                  {t('feed.error')}
                </Text>
              </Box>
            ) : null
          }
          contentContainerStyle={{ paddingTop: railHeight, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          onScroll={onFeedScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              // Nudge the spinner below the rail so it doesn't hide behind it.
              progressViewOffset={railHeight}
              tintColor={colors.inkMuted}
            />
          }
        />
        <Animated.View
          onLayout={onRailLayout}
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 5,
              backgroundColor: colors.bg,
            },
            railStyle,
          ]}
        >
          <Box pb="md">
            <CategoryRail
              categories={categoriesQuery.data ?? []}
              activeId={activeCat}
              onSelect={handleSelectRoot}
            />
          </Box>
        </Animated.View>
        </View>
      ) : (
        // Category selected → fixed rail(s) + a flat 2-column grid. The
        // grid is its own scroll surface, so the rail stays pinned here
        // (the collapsing behavior is scoped to the "All" feed above).
        <>
          <Box pb="md">
            <CategoryRail
              categories={categoriesQuery.data ?? []}
              activeId={activeCat}
              onSelect={handleSelectRoot}
            />
          </Box>
          {hasSubcategories && activeRoot ? (
            <Box pb="md">
              <SubcategoryRail
                parent={activeRoot}
                subcategories={activeRootChildren}
                activeChildId={activeSubcategoryId}
                onSelect={setActiveSubcategoryId}
              />
            </Box>
          ) : null}
          <CategoryGrid categoryId={gridCategoryId} />
        </>
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
