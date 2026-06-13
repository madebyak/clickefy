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
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { Icon } from '@/components/ui/Icon';
import { thumbnailUrl } from '@/lib/image-url';
import { LIBRARY_QUERY } from '@/lib/query-config';
import { getSDK } from '@/lib/sdk';
import { useRefreshOnFocus } from '@/lib/use-refresh-on-focus';

const FILTERS = ['All', 'Image', 'Video', 'Set'] as const;
type Filter = (typeof FILTERS)[number];

export default function SavedTemplatesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, accent } = useTheme();
  const { t } = useTranslation('saved');
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
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* Unified back-button header — same shape as result/generating/use
          screens. Title block stays separate so the page can keep its
          hero-style large title and counter beneath the navigation row. */}
      <ScreenHeader />
      <Box px="lg" pb="md">
        <Stack gap="sm">
          <Text variant="overline" color="inkMuted" transform="uppercase">
            {t('overline')}
          </Text>
          <Text variant="title" color="ink" style={{ fontSize: 36, lineHeight: 38 }}>
            {t('title')}
          </Text>
          <Text variant="caption" color="inkMuted">
            {t('subtitle', { count: (savedQuery.data ?? []).length })}
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
          <Chip
            key={f}
            label={t(`filters.${f.toLowerCase()}`)}
            active={filter === f}
            onPress={() => setFilter(f)}
          />
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
  const { t } = useTranslation('saved');
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
            source={thumbnailUrl(template.coverImage, { width: 200 })}
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
              end: 10,
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
          {t('credits', { count: template.credits })}
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
  const { t } = useTranslation('saved');
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
        {filter === 'All'
          ? t('empty.allTitle')
          : t('empty.filteredTitle', { filter: t(`filters.${filter.toLowerCase()}`) })}
      </Text>
      <Text variant="caption" color="inkMuted" align="center">
        {filter === 'All' ? t('empty.allDescription') : t('empty.filteredDescription')}
      </Text>
    </View>
  );
}
