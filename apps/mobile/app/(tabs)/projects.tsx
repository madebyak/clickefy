import { Badge, Box, Button, Card, HStack, Skeleton, Stack, Text, useTheme } from '@clickfy/ui';
import { useAuth } from '@clerk/expo';
import type { UserProject } from '@clickfy/sdk';
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
import { Alert, Pressable, RefreshControl, View } from 'react-native';
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
import { setGenerationOutputs } from '@/lib/generation-cache';
import { outputThumbnailUrl, thumbnailUrl } from '@/lib/image-url';
import { PROJECTS_QUERY } from '@/lib/query-config';
import { getSDK } from '@/lib/sdk';
import { useRefreshOnFocus } from '@/lib/use-refresh-on-focus';

/**
 * Projects — the user's generation history.
 *
 * Each row is wrapped in `ReanimatedSwipeable`. Pulling right→left
 * reveals a tonal delete action sized to match the row height. The
 * mutation is optimistic: we strip the row from the cache before
 * the network round-trip and roll back if the DELETE fails.
 *
 * Tap behaviour:
 *   • status === 'ready'      → result screen (cache pre-warmed)
 *   • status === 'queued'/'processing' → live `generating` screen
 *   • status === 'failed'     → also `generating`, which renders
 *     the retry CTA based on the error.
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

  // Cursor-paginated: the server caps a page at 50 and hands back a
  // `nextCursor`; scrolling near the end pulls the next page, so the
  // whole history is reachable instead of silently stopping at the
  // first page.
  const projectsQuery = useInfiniteQuery({
    queryKey: ['projects'],
    queryFn: ({ pageParam }) =>
      sdk.library.listProjects({ limit: 30, cursor: pageParam }),
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

  type ProjectsPage = { items: UserProject[]; nextCursor: string | null };
  type ProjectsData = InfiniteData<ProjectsPage, string | null>;

  const deleteMutation = useMutation({
    mutationFn: (jobId: string) => sdk.library.deleteProject(jobId),
    onMutate: async (jobId) => {
      await qc.cancelQueries({ queryKey: ['projects'] });
      const previous = qc.getQueryData<ProjectsData>(['projects']);
      // Optimistic remove across every loaded page; cursors are left
      // alone (they key off createdAt|id of rows that still exist).
      qc.setQueryData<ProjectsData>(['projects'], (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.filter((p) => p.id !== jobId),
              })),
            }
          : old,
      );
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return { previous };
    },
    onError: (_err, _jobId, ctx) => {
      // Roll back — the network call failed but the user already
      // saw the row vanish. Restoring keeps the list honest.
      if (ctx?.previous) qc.setQueryData(['projects'], ctx.previous);
      Alert.alert(t('error.title'), t('error.message'));
    },
    onSettled: () => {
      // The list mutation interacts with credit_ledger FKs server-side
      // (ON DELETE SET NULL). A background refetch keeps us aligned
      // even if the optimistic update drifted.
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const items = useMemo(
    () => projectsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [projectsQuery.data],
  );

  const handleOpenProject = useCallback(
    (p: UserProject) => {
      if (p.status === 'ready') {
        setGenerationOutputs(p.id, p.outputs);
        router.push({
          pathname: '/result/[jobId]',
          params: { jobId: p.id, templateId: p.templateId },
        });
      } else {
        router.push({
          pathname: '/generating',
          params: { jobId: p.id, templateId: p.templateId },
        });
      }
    },
    [router],
  );

  const handleConfirmDelete = useCallback(
    (p: UserProject) => {
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

function ProjectRow({
  project,
  onOpen,
  onRequestDelete,
  registerOpenRow,
}: {
  project: UserProject;
  onOpen: () => void;
  onRequestDelete: () => void;
  registerOpenRow: (row: SwipeableMethods | null) => void;
}) {
  const { colors, accent } = useTheme();
  const { t } = useTranslation('projects');
  const swipeableRef = useRef<SwipeableMethods>(null);

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
              }}
            >
              <Image
                // Row-sized derivative of the first output (grid use only —
                // the result screen opens the original): a video shows its
                // poster frame, an image its own thumb; template covers go
                // through the browse-media resizer as elsewhere.
                source={
                  outputThumbnailUrl(rowStill(project.outputs[0]), { width: 56 }) ??
                  thumbnailUrl(project.templateCoverImage || undefined, { width: 56 })
                }
                placeholder={
                  project.outputs[0]?.thumbhash
                    ? { thumbhash: project.outputs[0].thumbhash }
                    : undefined
                }
                placeholderContentFit="cover"
                recyclingKey={project.id}
                cachePolicy="memory-disk"
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                transition={150}
              />
            </View>
            <Stack gap="xs" style={{ flex: 1 }}>
              <Text variant="subhead" color="ink" weight="600" numberOfLines={1}>
                {project.title}
              </Text>
              <HStack align="center" gap="xs">
                {project.source === 'user' ? (
                  <>
                    <View
                      style={{
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        borderRadius: 7,
                        backgroundColor: accent.soft,
                      }}
                    >
                      <Text
                        color={accent.deep}
                        weight="700"
                        transform="uppercase"
                        style={{ fontSize: 10, letterSpacing: 0.4 }}
                      >
                        {t('customBadge')}
                      </Text>
                    </View>
                    <Dot color={colors.inkSubtle} />
                  </>
                ) : null}
                <Text variant="caption" color="inkMuted">
                  {project.whenLabel}
                </Text>
                {project.status === 'ready' ? (
                  <>
                    <Dot color={colors.inkSubtle} />
                    <Text variant="caption" color="inkMuted">
                      {t('outputs', { count: project.count })}
                    </Text>
                  </>
                ) : null}
                {project.status !== 'ready' ? <StatusBadge status={project.status} /> : null}
              </HStack>
            </Stack>
            <Icon name="chevronRight" size={16} color={colors.inkSubtle} weight="bold" />
          </HStack>
        </Card>
      </Pressable>
    </ReanimatedSwipeable>
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

/** The still an output can show in a row: the image itself, or a video's poster. */
function rowStill(output: UserProject['outputs'][number] | undefined): string | undefined {
  if (!output) return undefined;
  return output.kind === 'video' ? (output.posterUrl ?? undefined) : output.url;
}

function Dot({ color }: { color: string }) {
  return <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: color }} />;
}

function StatusBadge({ status }: { status: 'queued' | 'processing' | 'failed' }) {
  const { t } = useTranslation('projects');
  const tone = status === 'failed' ? 'danger' : 'neutral';
  const label = t(`status.${status}`);
  return <Badge label={label} tone={tone as 'danger' | 'neutral'} />;
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
