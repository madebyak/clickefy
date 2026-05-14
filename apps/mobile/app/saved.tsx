/**
 * Saved templates — the user's bookmarked templates.
 *
 * Reached from the header bookmark icon on the Library tab. Lives
 * outside the tab bar (just a stack route) because:
 *   • Most users save a handful of templates and won't visit often
 *     enough to justify a permanent tab slot.
 *   • The page mirrors the catalog template list, so re-using the
 *     same card shape keeps the visual story consistent — only the
 *     header differs.
 *
 * Empty state nudges the user toward how to save (tap the bookmark
 * on any template detail screen).
 */

import { Box, Chip, Pressable, Skeleton, Stack, Text, useTheme } from '@clickfy/ui';
import type { CatalogTemplate } from '@clickfy/sdk';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { LIBRARY_QUERY } from '@/lib/query-config';
import { getSDK } from '@/lib/sdk';
import { useRefreshOnFocus } from '@/lib/use-refresh-on-focus';

const FILTERS = ['All', 'Image', 'Video', 'Set'] as const;
type Filter = (typeof FILTERS)[number];

export default function SavedTemplatesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, accent } = useTheme();
  const sdk = getSDK();
  const [filter, setFilter] = useState<Filter>('All');

  const savedQuery = useQuery({
    queryKey: ['library-saved'],
    queryFn: () => sdk.library.listSavedTemplates({ limit: 50 }),
    ...LIBRARY_QUERY,
  });

  // Re-sync on screen focus so a freshly-saved bookmark shows up
  // when the user pops back from the template detail page.
  useRefreshOnFocus(savedQuery.refetch);

  const filtered = useMemo<CatalogTemplate[]>(() => {
    const data = savedQuery.data ?? [];
    if (filter === 'All') return data;
    const wanted = filter.toLowerCase() as CatalogTemplate['kind'];
    return data.filter((t) => t.kind === wanted);
  }, [savedQuery.data, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 8 }}>
      {/* Header — chevron back on the left, title block below */}
      <Box px="lg" pb="md">
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            haptic="light"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="chevronLeft" size={18} color={colors.ink} weight="bold" />
          </Pressable>
        </View>
        <Stack gap="sm">
          <Text variant="overline" color="inkMuted" transform="uppercase">
            Saved
          </Text>
          <Text variant="title" color="ink" style={{ fontSize: 36, lineHeight: 38 }}>
            Your bookmarks
          </Text>
          <Text variant="caption" color="inkMuted">
            {(savedQuery.data ?? []).length} template{(savedQuery.data ?? []).length === 1 ? '' : 's'} you&apos;ve saved
          </Text>
        </Stack>
      </Box>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingVertical: 4 }}
      >
        {FILTERS.map((f) => (
          <Chip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
        ))}
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 20, paddingBottom: 60, gap: 14 }}
        refreshControl={
          <RefreshControl
            refreshing={savedQuery.isRefetching && !savedQuery.isLoading}
            onRefresh={() => void savedQuery.refetch()}
            tintColor={colors.inkMuted}
          />
        }
      >
        {savedQuery.isLoading ? (
          <GridSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            {filtered.map((t) => (
              <View key={t.id} style={{ width: '47.5%' }}>
                <SavedCard
                  template={t}
                  accentSoft={accent.soft}
                  accentDeep={accent.deep}
                  onPress={() => router.push(`/template/${t.id}`)}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function SavedCard({
  template,
  accentSoft,
  accentDeep,
  onPress,
}: {
  template: CatalogTemplate;
  accentSoft: string;
  accentDeep: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress}>
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
            source={template.coverImage}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={150}
          />
          {/* Saved indicator — same icon as the template page heart
              so the visual story is consistent across screens. */}
          <View
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              width: 30,
              height: 30,
              borderRadius: 15,
              backgroundColor: accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="bookmark" size={13} color={accentDeep} weight="fill" />
          </View>
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

function GridSkeleton() {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} style={{ width: '47.5%', gap: 8 }}>
          <Skeleton height={200} radius={18} />
          <Skeleton height={14} width="80%" />
          <Skeleton height={12} width="55%" />
        </View>
      ))}
    </View>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const { colors, accent } = useTheme();
  return (
    <View
      style={{
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
        <Icon name="bookmark" size={22} color={accent.deep} weight="fill" />
      </View>
      <Text variant="bodySemi" color="ink">
        {filter === 'All' ? 'No saved templates yet' : `No ${filter.toLowerCase()} templates saved`}
      </Text>
      <Text variant="caption" color="inkMuted" align="center">
        {filter === 'All'
          ? 'Tap the bookmark on any template to keep it close at hand.'
          : 'Try a different filter, or open a template and tap the bookmark icon.'}
      </Text>
    </View>
  );
}
