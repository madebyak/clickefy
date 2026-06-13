/**
 * CategoryGrid — full-bleed 2-column infinite-scroll grid used by the
 * home tab whenever a category chip is selected.
 *
 * Why a separate component instead of inlining in `(tabs)/index.tsx`:
 *
 *   - The home feed (sections + banner) and the category grid are
 *     fundamentally different list shapes. Swapping the body when
 *     `activeCat` flips keeps each layout simple, and the FlashList
 *     stays out of nested-VirtualizedList territory.
 *
 *   - The grid also needs its own pagination state, skeletons, and
 *     empty state — colocating those keeps the home screen file from
 *     ballooning.
 *
 * Visual contract: `<TemplateCard />` in 2 columns with the same rhythm
 * as the `/section/[key]` page so users moving between "category mode"
 * and "see all" perceive the same surface.
 */

import { Skeleton, Text, useTheme } from '@clickfy/ui';
import type { CatalogTemplate } from '@clickfy/sdk';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ActiveFiltersBar } from '@/components/search/ActiveFiltersBar';
import { TemplateCard } from '@/components/home/TemplateCard';
import { SEARCH_QUERY } from '@/lib/query-config';
import { setSearchFilters, useSearchFilters } from '@/lib/search-state';
import { getSDK } from '@/lib/sdk';

const PAGE_SIZE = 24;

export interface CategoryGridProps {
  categoryId: string;
  /** Bottom inset matching the tab bar; passed through from the screen. */
  bottomInset?: number;
}

export function CategoryGrid({ categoryId, bottomInset = 120 }: CategoryGridProps) {
  const router = useRouter();
  const sdk = getSDK();

  // The home category surface shares the same filter store as
  // `/search`. Whatever the user toggled in `/search-filters` flows
  // straight into the listTemplates request below. Tapping a chip ✕
  // in `ActiveFiltersBar` clears that single filter and the grid
  // refetches in place — no navigation required. The category scope
  // itself comes from the `categoryId` prop (driven by the chip rail
  // above), not the store, so a "Beauty grid" can't accidentally
  // un-scope itself just because the user cleared filters.
  const filters = useSearchFilters();

  const listQuery = useInfiniteQuery({
    queryKey: [
      'category-grid',
      categoryId,
      filters.kind,
      filters.featured,
      filters.sort,
    ] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      sdk.catalog.listTemplates({
        categoryId,
        kind: filters.kind,
        featured: filters.featured,
        sort: filters.sort,
        limit: PAGE_SIZE,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    ...SEARCH_QUERY,
  });

  const items = useMemo<CatalogTemplate[]>(
    () => listQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [listQuery.data],
  );

  // Filter chip strip — only renders when toggled filters are active.
  // We intentionally hide the *category* chip here (the chip rail
  // above the bar is already the category-scope UI on this surface;
  // showing a second chip would be redundant and confusing).
  const chipFilters = useMemo(
    () => ({
      kind: filters.kind,
      featured: filters.featured,
      sort: filters.sort,
    }),
    [filters.kind, filters.featured, filters.sort],
  );

  return (
    <View style={{ flex: 1 }}>
      <ActiveFiltersBar
        filters={chipFilters}
        onClearKind={() => setSearchFilters({ kind: undefined })}
        onClearFeatured={() => setSearchFilters({ featured: undefined })}
        onClearSort={() => setSearchFilters({ sort: 'default' })}
        onClearAll={() =>
          setSearchFilters({
            kind: undefined,
            featured: undefined,
            sort: 'default',
          })
        }
      />
      {listQuery.isLoading ? (
        <ResultsSkeleton />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(t) => t.id}
          numColumns={2}
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: 7 }}>
              <TemplateCard
                template={item}
                onPress={() => router.push(`/template/${item.id}`)}
              />
            </View>
          )}
          ItemSeparatorComponent={RowGap}
          contentContainerStyle={{
            paddingTop: 6,
            paddingHorizontal: 13,
            paddingBottom: bottomInset,
          }}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
              void listQuery.fetchNextPage();
            }
          }}
          ListFooterComponent={
            listQuery.isFetchingNextPage ? <RowSkeleton /> : null
          }
        />
      )}
    </View>
  );
}

function RowGap() {
  return <View style={{ height: 14 }} />;
}

function RowSkeleton() {
  return (
    <View style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 7, marginTop: 14 }}>
      {[0, 1].map((i) => (
        <View key={i} style={{ flex: 1, gap: 8 }}>
          <Skeleton height={200} radius={18} />
          <Skeleton height={14} width="80%" />
        </View>
      ))}
    </View>
  );
}

function ResultsSkeleton() {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 6, gap: 14 }}>
      <RowSkeleton />
      <RowSkeleton />
      <RowSkeleton />
    </View>
  );
}

function EmptyState() {
  const { colors } = useTheme();
  const { t } = useTranslation('home');
  return (
    <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 6 }}>
      <Text variant="bodySemi" color="ink" align="center">
        {t('grid.emptyTitle')}
      </Text>
      <Text
        variant="caption"
        color="inkMuted"
        align="center"
        style={{ color: colors.inkMuted }}
      >
        {t('grid.emptyBody')}
      </Text>
    </View>
  );
}
