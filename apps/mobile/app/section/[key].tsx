/**
 * /section/[key] — full paginated list for a single home rail.
 *
 * Reached via the "See all" chevron on each home section. The route
 * carries two params:
 *
 *   - `key`   — section identifier matching `lib/section-config.ts`
 *               (e.g. `trending`, `new-arrivals`, `category-<uuid>`).
 *   - `title` — display title forwarded from the home screen so we
 *               render the header without a network round-trip. Not
 *               trusted (user-controlled URL) — only used for display.
 *
 * Visual pattern: 2-column FlashList grid using the same `<TemplateCard />`
 * as the home rails so kind chips, credit badges, and video autoplay
 * all match — users crossing between the home and the See All page
 * shouldn't perceive a card-style change.
 */

import { Box, Pressable, Skeleton, Text, useTheme } from '@clickfy/ui';
import type { CatalogTemplate } from '@clickfy/sdk';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TemplateCard } from '@/components/home/TemplateCard';
import { Icon } from '@/components/ui/Icon';
import { SEARCH_QUERY } from '@/lib/query-config';
import { resolveSectionSpec } from '@/lib/section-config';
import { getSDK } from '@/lib/sdk';

const PAGE_SIZE = 24;

export default function SectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('search');
  const sdk = getSDK();

  const params = useLocalSearchParams<{ key: string; title?: string }>();
  const sectionKey = String(params.key ?? '');
  const spec = useMemo(() => resolveSectionSpec(sectionKey), [sectionKey]);
  const title =
    (params.title && String(params.title)) || spec?.fallbackTitle || t('section.defaultTitle');

  const listQuery = useInfiniteQuery({
    queryKey: ['section-list', sectionKey] as const,
    enabled: spec !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      sdk.catalog.listTemplates({
        ...spec!.filters,
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <Header title={title} onBack={() => router.back()} />

      {spec === null ? (
        <UnknownSection />
      ) : listQuery.isLoading ? (
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
            paddingBottom: 120,
          }}
          showsVerticalScrollIndicator={false}
          // Same prefetch threshold as /search — 50% down the remaining
          // tail. Trades a bit of bandwidth on fast-scroll for zero
          // perceptible loading gap at the bottom of each page.
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
              void listQuery.fetchNextPage();
            }
          }}
          ListFooterComponent={listQuery.isFetchingNextPage ? <RowSkeleton /> : null}
        />
      )}
    </View>
  );
}

// ─── Header ────────────────────────────────────────────────────────

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation('search');
  return (
    <Box px="base" py="sm">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 40,
        }}
      >
        <Pressable
          onPress={onBack}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel={t('section.back')}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceMuted,
          }}
        >
          <Icon name="chevronLeft" size={18} color={colors.ink} weight="bold" />
        </Pressable>
        <Text variant="heading" color="ink" numberOfLines={1} style={{ flex: 1 }}>
          {title}
        </Text>
      </View>
    </Box>
  );
}

// ─── Skeletons / empty states ──────────────────────────────────────

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
  const { t } = useTranslation('search');
  return (
    <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 6 }}>
      <Text variant="bodySemi" color="ink" align="center">
        {t('section.empty.title')}
      </Text>
      <Text variant="caption" color="inkMuted" align="center">
        {t('section.empty.description')}
      </Text>
    </View>
  );
}

function UnknownSection() {
  const { t } = useTranslation('search');
  return (
    <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 6 }}>
      <Text variant="bodySemi" color="ink" align="center">
        {t('section.unknown.title')}
      </Text>
      <Text variant="caption" color="inkMuted" align="center">
        {t('section.unknown.description')}
      </Text>
    </View>
  );
}
