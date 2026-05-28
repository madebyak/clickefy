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
import { View } from 'react-native';

import { TemplateCard } from '@/components/home/TemplateCard';
import { SEARCH_QUERY } from '@/lib/query-config';
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

  const listQuery = useInfiniteQuery({
    queryKey: ['category-grid', categoryId] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      sdk.catalog.listTemplates({
        categoryId,
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

  if (listQuery.isLoading) return <ResultsSkeleton />;
  if (items.length === 0) return <EmptyState />;

  return (
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
      ListFooterComponent={listQuery.isFetchingNextPage ? <RowSkeleton /> : null}
    />
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
  return (
    <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 6 }}>
      <Text variant="bodySemi" color="ink" align="center">
        Nothing in this category yet
      </Text>
      <Text
        variant="caption"
        color="inkMuted"
        align="center"
        style={{ color: colors.inkMuted }}
      >
        Switch to another category, or back to All to browse the full feed.
      </Text>
    </View>
  );
}
