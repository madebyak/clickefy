import { Box, Chip, Pressable, Stack, Skeleton, Text, useTheme } from '@clickfy/ui';
import type { UserProject } from '@clickfy/sdk';
import { FlashList } from '@shopify/flash-list';
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

/**
 * Library — the user's recently-used templates, deduped by template id.
 *
 * Backed by `sdk.library.listRecentTemplates()` which wraps the same
 * `GET /v1/jobs` endpoint as the Projects tab and dedupes client-side.
 * Result: a small, naturally-curated set of "templates I keep coming
 * back to".
 *
 * A dedicated *Saved templates* view (explicit bookmarks) lives at
 * `/saved` and is reachable through the bookmark icon in this
 * header — keeping the two concepts on separate routes preserves
 * each one's mental model and bounces.
 */
export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, accent } = useTheme();
  const sdk = getSDK();
  const [filter, setFilter] = useState<Filter>('All');

  const libraryQuery = useQuery({
    queryKey: ['library-recent'],
    queryFn: () => sdk.library.listRecentTemplates({ limit: 24 }),
    ...LIBRARY_QUERY,
  });

  // Auto-refetch when the user tabs back in (after creating a new
  // generation, for example). Initial mount fetch is React-Query's
  // job — this hook only triggers on subsequent focuses.
  useRefreshOnFocus(libraryQuery.refetch);

  const filtered = useMemo<UserProject[]>(() => {
    const data = libraryQuery.data ?? [];
    if (filter === 'All') return data;
    const kind = filter.toLowerCase() as UserProject['templateKind'];
    return data.filter((t) => t.templateKind === kind);
  }, [libraryQuery.data, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 8 }}>
      {/* Header */}
      <Box px="lg" pb="md">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <Stack gap="sm" style={{ flex: 1 }}>
            <Text variant="overline" color="inkMuted" transform="uppercase">
              Library
            </Text>
            <Text variant="title" color="ink" style={{ fontSize: 36, lineHeight: 38 }}>
              Recent templates
            </Text>
            <Text variant="caption" color="inkMuted">
              {(libraryQuery.data ?? []).length} template{(libraryQuery.data ?? []).length === 1 ? '' : 's'} you&apos;ve used recently
            </Text>
          </Stack>
          {/* Saved → dedicated screen with the user's bookmarks.
              Lives in the header rather than tab bar so we don't
              spend a top-level slot on something most users will
              visit infrequently. */}
          <Pressable
            onPress={() => router.push('/saved')}
            accessibilityRole="button"
            accessibilityLabel="Saved templates"
            haptic="light"
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: accent.soft,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 24,
            }}
          >
            <Icon name="bookmark" size={20} color={accent.deep} weight="fill" />
          </Pressable>
        </View>
      </Box>

      {/* Filters
          A horizontal ScrollView inside a flex column expands to fill
          *vertical* space by default — that's the source of the giant
          empty band between chips and the grid. Pinning `flexGrow: 0`
          on the ScrollView itself plus tight vertical padding on the
          content keeps it as a single 40-ish-pt row. */}
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

      {/* Grid — FlashList in 2-column mode so a long history doesn't
          mount every card upfront. Card heights are roughly uniform
          (aspect-ratio 4:5 image + 2 lines text) so virtualization
          works cleanly without per-row measurement. */}
      {libraryQuery.isLoading ? (
        <View style={{ paddingTop: 12, paddingHorizontal: 20 }}>
          <GridSkeleton />
        </View>
      ) : (
        <FlashList
          data={filtered}
          keyExtractor={(item) => item.templateId}
          numColumns={2}
          renderItem={({ item }) => (
            // Outer wrapper provides the horizontal padding inside each
            // column cell so the column gap reads as visual breathing
            // room rather than a sharp edge — matches the prior
            // `flexWrap` + `gap: 14` layout pixel-for-pixel.
            <View style={{ paddingHorizontal: 7 }}>
              <RecentTemplateCard
                project={item}
                onPress={() => router.push(`/template/${item.templateId}`)}
              />
            </View>
          )}
          ItemSeparatorComponent={GridRowGap}
          ListEmptyComponent={<EmptyState filter={filter} />}
          contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 13, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={libraryQuery.isRefetching && !libraryQuery.isLoading}
              onRefresh={() => void libraryQuery.refetch()}
              tintColor={colors.inkMuted}
            />
          }
        />
      )}
    </View>
  );
}

function GridRowGap() {
  return <View style={{ height: 14 }} />;
}

function RecentTemplateCard({
  project,
  onPress,
}: {
  project: UserProject;
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
          {/* Prefer the user's latest output (more personal) over the
              stock template cover. Falls back gracefully when there
              are no outputs yet. */}
          <Image
            source={project.outputs[0]?.url ?? project.templateCoverImage ?? undefined}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={150}
          />
        </View>
        <Text variant="bodySemi" color="ink" numberOfLines={1}>
          {project.templateName}
        </Text>
        <Text variant="caption" color="inkMuted">
          Used {project.whenLabel}
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
  const { colors } = useTheme();
  return (
    <View
      style={{
        marginTop: 40,
        padding: 24,
        borderRadius: 22,
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        gap: 8,
      }}
    >
      <Text variant="bodySemi" color="ink">
        Nothing here yet
      </Text>
      <Text variant="caption" color="inkMuted" align="center">
        {filter === 'All'
          ? 'Generate from a template and it\u2019ll appear here automatically.'
          : `No ${filter.toLowerCase()} templates used recently. Try another filter.`}
      </Text>
    </View>
  );
}
