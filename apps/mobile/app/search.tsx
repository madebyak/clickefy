/**
 * Search screen — full-screen template discovery surface.
 *
 * UX flow (validated against iOS HIG and Material 3):
 *
 *   ┌────────────────────────────────────────┐
 *   │  ←  🔍  [type to search…]      ⓘ      │   SearchInput
 *   ├────────────────────────────────────────┤
 *   │   [Featured]  [Newest]   ✕             │   ActiveFiltersBar (only if any)
 *   ├────────────────────────────────────────┤
 *   │   2,341 results              ⚙ Filters │   meta row (count + open sheet)
 *   ├────────────────────────────────────────┤
 *   │   ┌────┐ ┌────┐                        │
 *   │   │    │ │    │   results grid         │   FlashList numColumns=2
 *   │   └────┘ └────┘                        │
 *   └────────────────────────────────────────┘
 *
 * Empty / pre-query state shows recent searches + the same category
 * rail that lives on home, so taps from here apply a category filter
 * and surface results immediately. No live AI suggestions — deferred
 * to a future phase.
 *
 * Performance contract:
 *   • Query text is debounced 300ms before triggering a network fetch.
 *     Keystrokes never hit the API directly — they only update local
 *     state. Industry-standard delay (Google, Apple, Material).
 *   • Filters apply instantly (no debounce) since they fire from a
 *     discrete tap, not a typing gesture.
 *   • Pagination via cursor — server returns 20 per page; we prefetch
 *     the next page when the user is within 8 rows of the bottom.
 */

import { Box, Pressable, Skeleton, Stack, Text, useTheme } from '@clickfy/ui';
import type { CatalogTemplate } from '@clickfy/sdk';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActiveFiltersBar } from '@/components/search/ActiveFiltersBar';
import { SearchInput } from '@/components/search/SearchInput';
import { Icon } from '@/components/ui/Icon';
import { thumbnailUrl } from '@/lib/image-url';
import { CATEGORIES_QUERY, SEARCH_QUERY } from '@/lib/query-config';
import {
  clearRecentSearches,
  getRecentSearches,
  pushRecentSearch,
  removeRecentSearch,
} from '@/lib/search-history';
import {
  countActiveFilters,
  setSearchFilters,
  useSearchFilters,
} from '@/lib/search-state';
import { getSDK } from '@/lib/sdk';

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const sdk = getSDK();
  const filters = useSearchFilters();

  // Optional scope handed in by the home tab when the user opens
  // search from a non-"all" category. We seed the filter store on
  // first arrival and then strip the params off the URL so a manual
  // chip-clear inside `/search` isn't immediately re-seeded by the
  // stale params on a remount. Same self-cleaning pattern as the
  // home banner deep-link.
  const { categoryId: scopeCategoryId, scopeLabel } = useLocalSearchParams<{
    categoryId?: string;
    scopeLabel?: string;
  }>();
  useEffect(() => {
    if (!scopeCategoryId) return;
    setSearchFilters({
      categoryId: scopeCategoryId,
      categoryLabel: scopeLabel ?? undefined,
    });
    router.setParams({ categoryId: undefined, scopeLabel: undefined });
  }, [scopeCategoryId, scopeLabel, router]);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length > 0;

  // Recent searches — local only. Reloaded on focus so the list stays
  // fresh after the user comes back from the result detail screen.
  const [recents, setRecents] = useState<string[]>([]);
  const reloadRecents = useCallback(() => {
    void getRecentSearches().then(setRecents);
  }, []);
  useFocusEffect(
    useCallback(() => {
      reloadRecents();
    }, [reloadRecents]),
  );

  // Whenever a debounced query stabilizes to a non-empty value, push
  // it onto the recents list. We only persist *committed* queries so
  // half-typed strings ("phot") don't pollute the rail.
  useEffect(() => {
    if (!trimmedQuery) return;
    void pushRecentSearch(trimmedQuery);
  }, [trimmedQuery]);

  // Categories — reused from the home empty-state pattern.
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => sdk.catalog.listCategories(),
    ...CATEGORIES_QUERY,
  });

  // The actual search query. Disabled when there's no input AND no
  // user filters — empty-state shows recents instead. Note we DO run
  // the query when filters alone are set (the user toggled "Featured"
  // before typing) — that's the explicit feedback in this PR.
  const activeFilterCount = countActiveFilters(filters);
  const enabled = hasQuery || activeFilterCount > 0;

  const resultsQuery = useInfiniteQuery({
    queryKey: ['search-templates', trimmedQuery, filters] as const,
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      sdk.catalog.listTemplates({
        search: trimmedQuery || undefined,
        kind: filters.kind,
        categoryId: filters.categoryId,
        featured: filters.featured,
        sort: filters.sort,
        limit: PAGE_SIZE,
        cursor: pageParam,
        // Only ask for a count on the first page — pagination requests
        // don't need it and re-counting per page would double DB load.
        withCount: pageParam === undefined,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    ...SEARCH_QUERY,
  });

  const items = useMemo<CatalogTemplate[]>(
    () => resultsQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [resultsQuery.data],
  );
  const total = resultsQuery.data?.pages[0]?.total;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <Box px="base" py="sm">
        <SearchInput
          value={query}
          onChangeText={setQuery}
          placeholder={
            filters.categoryLabel
              ? `Search in ${filters.categoryLabel}`
              : 'Search templates'
          }
          onSubmit={(v) => {
            // Submitting persists the query immediately rather than
            // waiting for the debounce. Useful when the user types
            // fast and hits return — feels more deterministic.
            const trimmed = v.trim();
            if (trimmed) void pushRecentSearch(trimmed).then(reloadRecents);
            Keyboard.dismiss();
          }}
          onBack={() => router.back()}
        />
      </Box>

      <ActiveFiltersBar
        filters={filters}
        onClearKind={() => setSearchFilters({ kind: undefined })}
        onClearFeatured={() => setSearchFilters({ featured: undefined })}
        onClearSort={() => setSearchFilters({ sort: 'default' })}
        onClearCategory={() =>
          setSearchFilters({ categoryId: undefined, categoryLabel: undefined })
        }
        onClearAll={() =>
          setSearchFilters({
            kind: undefined,
            featured: undefined,
            sort: 'default',
            categoryId: undefined,
            categoryLabel: undefined,
          })
        }
      />

      {/* Meta row — total count on the left, filters button on the
          right. Total comes from the server's `withCount` envelope and
          is rendered as soon as page 1 lands. */}
      {enabled ? (
        <Box px="base" pb="sm">
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text variant="caption" color="inkMuted">
              {resultsQuery.isLoading
                ? 'Searching…'
                : total !== undefined
                  ? `${formatCount(total)} result${total === 1 ? '' : 's'}`
                  : `${items.length} result${items.length === 1 ? '' : 's'}`}
            </Text>
            <FilterButton
              activeCount={activeFilterCount}
              onPress={() =>
                router.push({
                  pathname: '/search-filters',
                  params: { q: trimmedQuery },
                })
              }
            />
          </View>
        </Box>
      ) : null}

      {!enabled ? (
        <RecentsAndCategories
          recents={recents}
          onPickRecent={(q) => setQuery(q)}
          onRemoveRecent={async (q) => {
            await removeRecentSearch(q);
            reloadRecents();
          }}
          onClearRecents={async () => {
            await clearRecentSearches();
            reloadRecents();
          }}
          categories={(categoriesQuery.data ?? []).map((c) => ({
            id: c.id,
            label: c.label,
            imageUri: c.imageUri,
            color: c.color,
          }))}
          onPickCategory={(id) => {
            // Tapping a category from the empty state isn't filterable
            // here — the public list endpoint takes a single category
            // — so we route to the home screen with that category
            // pre-selected. (Out of scope to deep-link into home with
            // a category param right now; we just dismiss search.)
            void id;
            router.back();
          }}
        />
      ) : resultsQuery.isLoading ? (
        <ResultsSkeleton />
      ) : items.length === 0 ? (
        <NoResults query={trimmedQuery} onClearFilters={() =>
          setSearchFilters({
            kind: undefined,
            featured: undefined,
            sort: 'default',
            categoryId: undefined,
            categoryLabel: undefined,
          })
        } />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(t) => t.id}
          numColumns={2}
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: 7 }}>
              <ResultCard
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
          // Prefetch when the user nears the end of the current page.
          // 0.5 = "load next page when 50% down the remaining list".
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (resultsQuery.hasNextPage && !resultsQuery.isFetchingNextPage) {
              void resultsQuery.fetchNextPage();
            }
          }}
          ListFooterComponent={
            resultsQuery.isFetchingNextPage ? <RowSkeleton /> : null
          }
        />
      )}
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function FilterButton({
  activeCount,
  onPress,
}: {
  activeCount: number;
  onPress: () => void;
}) {
  const { colors, accent } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={`Filters${activeCount > 0 ? ` (${activeCount} active)` : ''}`}
      style={{
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <Icon name="sliders" size={14} color={colors.ink} weight="bold" />
      <Text variant="caption" color="ink" weight="600" style={{ fontSize: 12.5 }}>
        Filters
      </Text>
      {activeCount > 0 ? (
        <View
          style={{
            minWidth: 18,
            height: 18,
            paddingHorizontal: 5,
            borderRadius: 9,
            backgroundColor: accent.solid,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            variant="mono"
            weight="700"
            style={{ fontSize: 10.5, lineHeight: 12, color: accent.ink }}
          >
            {activeCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ResultCard({
  template,
  onPress,
}: {
  template: CatalogTemplate;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} haptic="light" pressedOpacity={0.92}>
      <Stack gap="sm">
        <View
          style={{
            aspectRatio: 4 / 5,
            borderRadius: 18,
            overflow: 'hidden',
            backgroundColor: colors.surfaceMuted,
          }}
        >
          <Image
            source={thumbnailUrl(template.coverImage, { width: 200 })}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={150}
          />
        </View>
        <Text variant="bodySemi" color="ink" numberOfLines={1}>
          {template.title}
        </Text>
        <Text variant="caption" color="inkMuted">
          {template.credits} credits
        </Text>
      </Stack>
    </Pressable>
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
          <Skeleton height={12} width="55%" />
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

function NoResults({
  query,
  onClearFilters,
}: {
  query: string;
  onClearFilters: () => void;
}) {
  const { colors, accent } = useTheme();
  return (
    <View
      style={{
        margin: 20,
        marginTop: 40,
        padding: 28,
        borderRadius: 22,
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        gap: 10,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: accent.soft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 4,
        }}
      >
        <Icon name="search" size={22} color={accent.deep} weight="bold" />
      </View>
      <Text variant="bodySemi" color="ink">
        No results
      </Text>
      <Text variant="caption" color="inkMuted" align="center">
        {query
          ? `No templates match "${query}". Try a different keyword or clear your filters.`
          : 'No templates match these filters. Try widening the criteria.'}
      </Text>
      <Pressable
        onPress={onClearFilters}
        haptic="light"
        accessibilityRole="button"
        style={{
          marginTop: 4,
          height: 36,
          paddingHorizontal: 14,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant="caption" color="ink" weight="600" style={{ fontSize: 12.5 }}>
          Clear filters
        </Text>
      </Pressable>
    </View>
  );
}

function RecentsAndCategories({
  recents,
  onPickRecent,
  onRemoveRecent,
  onClearRecents,
  categories,
  onPickCategory,
}: {
  recents: string[];
  onPickRecent: (q: string) => void;
  onRemoveRecent: (q: string) => void | Promise<void>;
  onClearRecents: () => void | Promise<void>;
  categories: { id: string; label: string; imageUri: string | null; color: string }[];
  onPickCategory: (id: string) => void;
}) {
  const { colors } = useTheme();

  // Plain ScrollView is fine here — recents+categories fit in one
  // viewport on every common phone size, and we already use ScrollView
  // for the same shape on /saved.
  return (
    <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
      {recents.length > 0 ? (
        <Stack gap="sm" style={{ marginBottom: 24 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text variant="overline" color="inkMuted" transform="uppercase">
              Recent
            </Text>
            <Pressable
              onPress={() => void onClearRecents()}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel="Clear recent searches"
            >
              <Text variant="caption" color="inkMuted" weight="600">
                Clear
              </Text>
            </Pressable>
          </View>
          {recents.map((q) => (
            <View
              key={q}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 8,
              }}
            >
              <Pressable
                onPress={() => onPickRecent(q)}
                haptic="light"
                accessibilityRole="button"
                accessibilityLabel={`Search ${q}`}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <Icon name="clock" size={18} color={colors.inkMuted} />
                <Text variant="body" color="ink" numberOfLines={1} style={{ flex: 1 }}>
                  {q}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void onRemoveRecent(q)}
                haptic="light"
                accessibilityRole="button"
                accessibilityLabel={`Remove ${q} from recents`}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="close" size={14} color={colors.inkMuted} />
              </Pressable>
            </View>
          ))}
        </Stack>
      ) : null}

      {categories.length > 0 ? (
        <Stack gap="sm">
          <Text variant="overline" color="inkMuted" transform="uppercase">
            Browse categories
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => onPickCategory(c.id)}
                haptic="selection"
                accessibilityRole="button"
                accessibilityLabel={`Browse ${c.label}`}
                style={{
                  height: 34,
                  paddingHorizontal: 14,
                  borderRadius: 17,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  flexDirection: 'row',
                  alignItems: 'center',
                  alignSelf: 'flex-start',
                }}
              >
                <Text variant="caption" color="ink" weight="500" style={{ fontSize: 13 }}>
                  {c.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Stack>
      ) : null}
    </View>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Returns the input value, but only after it's been stable for `delay`
 * milliseconds. Used to avoid hammering the search endpoint on every
 * keystroke. Inlined here because we don't have other consumers yet —
 * promote to `lib/` if a second screen needs it.
 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
