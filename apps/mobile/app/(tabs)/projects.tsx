import { Box, Button, Card, HStack, Skeleton, Stack, Text, useTheme } from '@clickfy/ui';
import { useAuth } from '@clerk/expo';
import type { StudioProject } from '@clickfy/sdk';
import * as Sentry from '@sentry/react-native';
import { FlashList } from '@shopify/flash-list';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, RefreshControl, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '@/components/shared/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { outputThumbnailUrl } from '@/lib/image-url';
import { PROJECTS_QUERY } from '@/lib/query-config';
import { useRelativeTime } from '@/lib/relative-time';
import { getSDK } from '@/lib/sdk';
import { useRefreshOnFocus } from '@/lib/use-refresh-on-focus';

/**
 * Projects — the same list the web studio's sidebar shows: ONE row per
 * project, labelled by how it was born (Create / Template / Tool), with
 * its cover and how much it holds. Generations made in Create and
 * template runs land in the same list, because both file into projects.
 *
 * Tap behaviour comes from the server's `opensAs`:
 *   • 'result'   → a template-born project still holding only template
 *                  runs: the newest run's result screen (Regenerate /
 *                  Tweak / Open in Create live there).
 *   • 'composer' → everything else opens in Create with the project loaded.
 *
 * Each row is wrapped in `ReanimatedSwipeable`. Pulling right→left
 * reveals a tonal delete action; the delete removes the WHOLE project
 * (every run and asset in it) after a confirm, optimistically, rolling
 * back if the DELETE fails.
 */
export default function ProjectsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('projects');
  const sdk = getSDK();
  const qc = useQueryClient();
  // Never fire before Clerk has a session to sign the request with: an
  // early unauthenticated fetch fails, and that failure used to render
  // as "no projects yet" until a manual refresh.
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const authReady = authLoaded && !!isSignedIn;

  // Breadcrumbs for the "tab renders blank" report (TestFlight 1.0.1(7)):
  // no error reaches Sentry when it happens, so the next occurrence
  // needs a trail of what mounted and when.
  useEffect(() => {
    Sentry.addBreadcrumb({ category: 'screen', message: 'projects mount', level: 'info' });
    return () => {
      Sentry.addBreadcrumb({ category: 'screen', message: 'projects unmount', level: 'info' });
    };
  }, []);

  // Track the most-recently-opened swipeable so opening a new one
  // closes the previous one. Mirrors iOS Mail's "only one row at
  // a time" behaviour — without it the UI feels chaotic.
  const openRowRef = useRef<SwipeableMethods | null>(null);

  // Cursor-paginated over `updated_at DESC`; scrolling near the end
  // pulls the next page, so the whole list is reachable.
  const projectsQuery = useInfiniteQuery({
    queryKey: ['projects'],
    queryFn: ({ pageParam }) =>
      sdk.projects.list({ limit: 30, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: authReady,
    ...PROJECTS_QUERY,
  });

  // Refetch when the user tabs back to this screen. The initial mount
  // fetch is handled by React-Query itself; this hook only fires on
  // subsequent focuses. Pull-to-refresh below covers the explicit
  // "force me a fresh copy" gesture.
  useRefreshOnFocus(projectsQuery.refetch);

  type ProjectsPage = Awaited<ReturnType<typeof sdk.projects.list>>;
  type ProjectsData = InfiniteData<ProjectsPage, string | null>;

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => sdk.projects.delete(projectId),
    onMutate: async (projectId) => {
      await qc.cancelQueries({ queryKey: ['projects'] });
      const previous = qc.getQueryData<ProjectsData>(['projects']);
      // Optimistic remove across every loaded page; cursors are left
      // alone (they key off updatedAt|id of rows that still exist).
      qc.setQueryData<ProjectsData>(['projects'], (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                projects: page.projects.filter((p) => p.id !== projectId),
              })),
            }
          : old,
      );
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return { previous };
    },
    onError: (_err, _projectId, ctx) => {
      // Roll back — the network call failed but the user already
      // saw the row vanish. Restoring keeps the list honest.
      if (ctx?.previous) qc.setQueryData(['projects'], ctx.previous);
      Alert.alert(t('error.title'), t('error.message'));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      // The composer's drawer reads the same projects through its own key.
      void qc.invalidateQueries({ queryKey: ['studio-projects'] });
    },
  });

  const items = useMemo(
    () => projectsQuery.data?.pages.flatMap((page) => page.projects) ?? [],
    [projectsQuery.data],
  );

  const handleOpenProject = useCallback(
    (p: StudioProject) => {
      if (p.opensAs === 'result' && p.latestJobId) {
        router.push({
          pathname: '/result/[jobId]',
          params: { jobId: p.latestJobId, templateId: p.originTemplateId ?? '' },
        });
      } else {
        router.push({ pathname: '/composer', params: { projectId: p.id } });
      }
    },
    [router],
  );

  const handleConfirmDelete = useCallback(
    (p: StudioProject) => {
      Alert.alert(
        t('deleteConfirm.title'),
        t('deleteConfirm.message'),
        [
          { text: t('deleteConfirm.cancel'), style: 'cancel', onPress: () => openRowRef.current?.close() },
          {
            text: t('deleteConfirm.confirm'),
            style: 'destructive',
            onPress: () => {
              openRowRef.current?.close();
              openRowRef.current = null;
              deleteMutation.mutate(p.id);
            },
          },
        ],
      );
    },
    [deleteMutation, t],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 16 }}>
      <Box px="lg" pb="md">
        <Stack gap="sm">
          <Text variant="overline" color="inkMuted" transform="uppercase">
            {t('overline')}
          </Text>
          <Text variant="title" color="ink">
            {t('title')}
          </Text>
        </Stack>
      </Box>
      {projectsQuery.isLoading || !authReady ? (
        // First-paint skeleton state — small fixed count, no need for
        // virtualization. Lives outside the FlashList so the list's
        // own ListEmptyComponent path stays reserved for the real
        // "no projects" case. Also shown while the query waits on auth
        // (a disabled query is `pending` but not `loading` in v5).
        <View style={{ padding: 20, gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={86} radius={18} />
          ))}
        </View>
      ) : projectsQuery.isError && items.length === 0 ? (
        // Nothing cached to show — say so, with a way back. Once a page
        // is cached a failed refetch keeps the list and stays quiet.
        <View style={{ padding: 20 }}>
          <ErrorState
            title={t('loadError')}
            onRetry={() => void projectsQuery.refetch()}
            retrying={projectsQuery.isFetching}
          />
        </View>
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ProjectRow
              project={item}
              onOpen={() => handleOpenProject(item)}
              onRequestDelete={() => handleConfirmDelete(item)}
              registerOpenRow={(row) => {
                // Auto-close any previously-open row on a new swipe.
                if (openRowRef.current && openRowRef.current !== row) {
                  openRowRef.current.close();
                }
                openRowRef.current = row;
              }}
            />
          )}
          // FlashList v2 auto-measures every item — no estimatedItemSize
          // hint required. ItemSeparator handles the inter-row gap;
          // composing with a container `gap` would break virtualization.
          ItemSeparatorComponent={ItemGap}
          ListEmptyComponent={<EmptyState />}
          // Pull the next page when the user nears the bottom. The guard
          // on isFetchingNextPage stops the burst of onEndReached events
          // a fast fling fires from queueing duplicate requests.
          onEndReached={() => {
            if (projectsQuery.hasNextPage && !projectsQuery.isFetchingNextPage) {
              void projectsQuery.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            projectsQuery.isFetchingNextPage ? (
              <View style={{ paddingVertical: 16, gap: 12 }}>
                <Skeleton height={86} radius={18} />
              </View>
            ) : null
          }
          contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={projectsQuery.isRefetching && !projectsQuery.isLoading}
              onRefresh={() => void projectsQuery.refetch()}
              tintColor={colors.inkMuted}
            />
          }
        />
      )}
    </View>
  );
}

// Vertical gap between rows — FlashList prefers ItemSeparatorComponent
// over `gap` on the container because the latter doesn't compose with
// item recycling. 12pt matches the prior ScrollView's `gap: 12`.
function ItemGap() {
  return <View style={{ height: 12 }} />;
}

// ─── Row ────────────────────────────────────────────────────────────

/** Row thumb: an image cover resized for the slot; a video cover's poster frame. */
function coverStill(cover: StudioProject['cover']): string | undefined {
  if (!cover) return undefined;
  const still = cover.kind === 'video' ? cover.posterUrl : cover.url;
  return still ? outputThumbnailUrl(still, { width: 56 }) : undefined;
}

function ProjectRow({
  project,
  onOpen,
  onRequestDelete,
  registerOpenRow,
}: {
  project: StudioProject;
  onOpen: () => void;
  onRequestDelete: () => void;
  registerOpenRow: (row: SwipeableMethods | null) => void;
}) {
  const { colors, accent } = useTheme();
  const { t } = useTranslation('projects');
  const relTime = useRelativeTime();
  const swipeableRef = useRef<SwipeableMethods>(null);
  const still = coverStill(project.cover);
  const thumbhash = project.cover?.thumbhash ?? undefined;

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      friction={2}
      rightThreshold={40}
      // Cap the trailing pane width so super-long swipes don't tear
      // the row off-screen on tablets. 92pt matches our 44pt icon
      // button + comfortable padding.
      overshootRight={false}
      renderRightActions={(_progress, translation) => (
        <DeleteAction translation={translation} onPress={onRequestDelete} />
      )}
      onSwipeableWillOpen={() => registerOpenRow(swipeableRef.current)}
      onSwipeableClose={() => registerOpenRow(null)}
    >
      <Pressable onPress={onOpen} accessibilityRole="button">
        <Card elevation="raised">
          <HStack align="center" gap="md">
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: colors.surfaceMuted,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {still || thumbhash ? (
                <Image
                  source={still}
                  placeholder={thumbhash ? { thumbhash } : undefined}
                  placeholderContentFit="cover"
                  recyclingKey={project.id}
                  cachePolicy="memory-disk"
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <Icon name="sparkle" size={18} color={colors.inkMuted} />
              )}
            </View>
            <Stack gap="xs" style={{ flex: 1 }}>
              <Text variant="subhead" color="ink" weight="600" numberOfLines={1}>
                {project.name}
              </Text>
              <HStack align="center" gap="xs">
                <OriginBadge origin={project.origin} />
                <Dot color={colors.inkSubtle} />
                <Text variant="caption" color="inkMuted">
                  {relTime(project.updatedAt)}
                </Text>
                <Dot color={colors.inkSubtle} />
                <Text variant="caption" color="inkMuted">
                  {t('outputs', { count: project.assetCount })}
                </Text>
              </HStack>
            </Stack>
            {(project.activeJobCount ?? 0) > 0 ? (
              // Something is generating inside — the chevron gives way to
              // a live indicator, the same cue the composer's drawer shows.
              <ActivityIndicator size="small" color={accent.solid} />
            ) : (
              <Icon name="chevronRight" size={16} color={colors.inkSubtle} weight="bold" />
            )}
          </HStack>
        </Card>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

/** How the project was born. Create rides the brand accent; the rest stay tonal. */
function OriginBadge({ origin = 'create' }: { origin: StudioProject['origin'] }) {
  const { colors, accent } = useTheme();
  const { t } = useTranslation('projects');
  const brand = origin === 'create';
  return (
    <View
      style={{
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 7,
        backgroundColor: brand ? accent.soft : colors.surfaceMuted,
      }}
    >
      <Text
        color={brand ? accent.deep : colors.inkMuted}
        weight="700"
        transform="uppercase"
        style={{ fontSize: 10, letterSpacing: 0.4 }}
      >
        {t(`origin.${origin}`)}
      </Text>
    </View>
  );
}

// ─── Delete action (the panel revealed on swipe) ────────────────────

const ACTION_WIDTH = 92;

function DeleteAction({
  translation,
  onPress,
}: {
  translation: SharedValue<number>;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('projects');

  // Slide the action in from the right. While the row is being
  // dragged, `translation.value` runs from 0 (closed) to -ACTION_WIDTH
  // (fully open). We mirror that on the action itself for a tight,
  // physical feel — Mail-app style.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          translation.value,
          [-ACTION_WIDTH, 0],
          [0, ACTION_WIDTH],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          width: ACTION_WIDTH,
          // Match the Card's outer radius on the right edge so the
          // reveal blends visually with the row rather than looking
          // like a tacked-on rectangle.
          justifyContent: 'center',
          alignItems: 'center',
          paddingStart: 12,
        },
        animatedStyle,
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('deleteAccessibilityLabel')}
        style={({ pressed }) => ({
          width: 56,
          height: 56,
          borderRadius: 18,
          backgroundColor: colors.danger,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
          shadowColor: colors.danger,
          shadowOpacity: 0.35,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        })}
      >
        <Icon name="trash" size={22} color="#FFFFFF" weight="bold" />
      </Pressable>
    </Animated.View>
  );
}

// ─── Small helpers ──────────────────────────────────────────────────

function Dot({ color }: { color: string }) {
  return <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: color }} />;
}

function EmptyState() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('projects');
  return (
    <View
      style={{
        marginTop: 60,
        padding: 24,
        borderRadius: 22,
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Text variant="bodySemi" color="ink">
        {t('empty.title')}
      </Text>
      <Text variant="caption" color="inkMuted" align="center">
        {t('empty.description')}
      </Text>
      <Button variant="accent" size="md" full onPress={() => router.push('/(tabs)')}>
        {t('empty.cta')}
      </Button>
    </View>
  );
}
