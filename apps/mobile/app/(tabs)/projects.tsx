import { Box, Button, Card, Chip, HStack, Skeleton, Stack, Text, useTheme } from '@clickfy/ui';
import { useAuth } from '@clerk/expo';
import type { StudioProject } from '@clickfy/sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
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
 * Above the list: a name search (server-side, debounced) and origin
 * filter chips, and a list ⇄ two-column grid toggle remembered on the
 * device. Search and filter travel in the query key, so each
 * combination is its own cached, paginated list.
 *
 * Tap behaviour comes from the server's `opensAs`:
 *   • 'result'   → a template-born project still holding only template
 *                  runs: the newest run's result screen (Regenerate /
 *                  Tweak / Open in Create live there).
 *   • 'composer' → everything else opens in Create with the project loaded.
 *
 * Delete removes the WHOLE project (every run and asset in it) after a
 * confirm, optimistically, rolling back if the DELETE fails — swipe
 * right→left on a row, long-press on a grid card.
 */

type OriginFilter = StudioProject['origin'] | null;
type ViewMode = 'list' | 'grid';

const VIEW_STORAGE_KEY = 'clickefy:projects-view';
const SEARCH_DEBOUNCE_MS = 300;
/** Skeleton appears only when loading outlasts this — fast loads never flash it. */
const SKELETON_DELAY_MS = 250;
const ORIGIN_FILTERS: NonNullable<OriginFilter>[] = ['create', 'template', 'tool'];

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

  // ── Search / filter / view ─────────────────────────────────────────
  const [searchText, setSearchText] = useState('');
  const query = useDebounced(searchText.trim(), SEARCH_DEBOUNCE_MS);
  const [origin, setOrigin] = useState<OriginFilter>(null);
  const [view, setView] = useStoredView();
  const filtersActive = query.length > 0 || origin !== null;

  // Track the most-recently-opened swipeable so opening a new one
  // closes the previous one. Mirrors iOS Mail's "only one row at
  // a time" behaviour — without it the UI feels chaotic.
  const openRowRef = useRef<SwipeableMethods | null>(null);

  // Cursor-paginated over `updated_at DESC`; scrolling near the end
  // pulls the next page, so the whole list is reachable. The search and
  // filter are part of the key, so `['projects']` invalidations still
  // reach every variant.
  const listKey = useMemo(() => ['projects', { q: query, origin }] as const, [query, origin]);
  const projectsQuery = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam }) =>
      sdk.projects.list({
        limit: 30,
        cursor: pageParam ?? undefined,
        q: query || undefined,
        origin: origin ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: authReady,
    // A new search keeps the previous results on screen (dimmed by the
    // fetch state) instead of flashing empty between keystrokes.
    placeholderData: (prev) => prev,
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
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<ProjectsData>(listKey);
      // Optimistic remove across every loaded page; cursors are left
      // alone (they key off updatedAt|id of rows that still exist).
      qc.setQueryData<ProjectsData>(listKey, (old) =>
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
      if (ctx?.previous) qc.setQueryData(listKey, ctx.previous);
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

  const registerOpenRow = useCallback((row: SwipeableMethods | null) => {
    // Auto-close any previously-open row on a new swipe.
    if (openRowRef.current && openRowRef.current !== row) {
      openRowRef.current.close();
    }
    openRowRef.current = row;
  }, []);

  const showSkeleton = useDelayedFlag(projectsQuery.isLoading || !authReady, SKELETON_DELAY_MS);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 16 }}>
      <Box px="lg" pb="sm">
        <HStack align="flex-end" gap="md">
          <Stack gap="sm" style={{ flex: 1 }}>
            <Text variant="overline" color="inkMuted" transform="uppercase">
              {t('overline')}
            </Text>
            <Text variant="title" color="ink">
              {t('title')}
            </Text>
          </Stack>
          <ViewToggle view={view} onChange={setView} />
        </HStack>
      </Box>

      <Box px="lg" pb="md">
        <Stack gap="sm">
          <SearchField
            value={searchText}
            onChangeText={setSearchText}
            placeholder={t('searchPlaceholder')}
            busy={projectsQuery.isFetching && query.length > 0}
          />
          <HStack gap="xs">
            <Chip size="sm" label={t('filterAll')} active={origin === null} onPress={() => setOrigin(null)} />
            {ORIGIN_FILTERS.map((o) => (
              <Chip
                key={o}
                size="sm"
                label={t(`origin.${o}`)}
                active={origin === o}
                onPress={() => setOrigin(origin === o ? null : o)}
              />
            ))}
          </HStack>
        </Stack>
      </Box>

      {projectsQuery.isLoading || !authReady ? (
        // First-paint state, held back a beat so fast loads never flash
        // a skeleton. Lives outside the FlashList so the list's own
        // ListEmptyComponent path stays reserved for the real "no
        // projects" case. Also shown while the query waits on auth (a
        // disabled query is `pending` but not `loading` in v5).
        showSkeleton ? (
          <View style={{ padding: 20, gap: 12 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={86} radius={18} />
            ))}
          </View>
        ) : null
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
          // Switching column count needs a fresh list; the key forces it.
          key={view}
          data={items}
          numColumns={view === 'grid' ? 2 : 1}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) =>
            view === 'grid' ? (
              <GridCard
                project={item}
                onOpen={() => handleOpenProject(item)}
                onRequestDelete={() => handleConfirmDelete(item)}
              />
            ) : (
              <ProjectRow
                project={item}
                onOpen={() => handleOpenProject(item)}
                onRequestDelete={() => handleConfirmDelete(item)}
                registerOpenRow={registerOpenRow}
              />
            )
          }
          // FlashList v2 auto-measures every item — no estimatedItemSize
          // hint required. ItemSeparator handles the inter-row gap;
          // composing with a container `gap` would break virtualization.
          ItemSeparatorComponent={ItemGap}
          ListEmptyComponent={
            filtersActive ? (
              <NoMatches
                onClear={() => {
                  setSearchText('');
                  setOrigin(null);
                }}
              />
            ) : (
              <EmptyState />
            )
          }
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
          contentContainerStyle={{ padding: view === 'grid' ? 14 : 20, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={projectsQuery.isRefetching && !projectsQuery.isLoading && !query}
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

// ─── Hooks ──────────────────────────────────────────────────────────

/** The value, settled: updates only after `ms` without a change. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** True only once `flag` has stayed true for `ms` — the skeleton-flash guard. */
function useDelayedFlag(flag: boolean, ms: number): boolean {
  const settled = useDebounced(flag, ms);
  return flag && settled;
}

/**
 * The list ⇄ grid choice, remembered per device. Browser-style storage
 * only: it may be empty or unavailable, and the screen must render the
 * default either way.
 */
function useStoredView(): [ViewMode, (next: ViewMode) => void] {
  const [view, setViewState] = useState<ViewMode>('list');
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(VIEW_STORAGE_KEY)
      .then((v) => {
        if (!cancelled && v === 'grid') setViewState('grid');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const setView = useCallback((next: ViewMode) => {
    setViewState(next);
    AsyncStorage.setItem(VIEW_STORAGE_KEY, next).catch(() => undefined);
  }, []);
  return [view, setView];
}

// ─── Header controls ────────────────────────────────────────────────

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation('projects');
  const next: ViewMode = view === 'list' ? 'grid' : 'list';
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onChange(next);
      }}
      accessibilityRole="button"
      accessibilityLabel={next === 'grid' ? t('viewGrid') : t('viewList')}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 13,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={next === 'grid' ? 'categories' : 'menu'} size={18} color={colors.ink} />
    </Pressable>
  );
}

function SearchField({
  value,
  onChangeText,
  placeholder,
  busy,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  busy: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: 46,
        paddingStart: 14,
        paddingEnd: 8,
        borderRadius: 16,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Icon name="search" size={18} color={colors.inkMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="never"
        accessibilityRole="search"
        style={{ flex: 1, height: '100%', fontSize: 15, color: colors.ink }}
      />
      {busy ? (
        <ActivityIndicator size="small" color={colors.inkMuted} style={{ marginEnd: 6 }} />
      ) : value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          hitSlop={8}
          style={{ padding: 6 }}
        >
          <Icon name="close" size={14} color={colors.inkMuted} weight="bold" />
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Row (list view) ────────────────────────────────────────────────

/** Row thumb: an image cover resized for the slot; a video cover's poster frame. */
function coverStill(cover: StudioProject['cover'], width: number): string | undefined {
  if (!cover) return undefined;
  const still = cover.kind === 'video' ? cover.posterUrl : cover.url;
  return still ? outputThumbnailUrl(still, { width }) : undefined;
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
  const still = coverStill(project.cover, 56);
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
            <CoverThumb uri={still} thumbhash={thumbhash} recyclingKey={project.id} size={56} radius={14} />
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

// ─── Card (grid view) ───────────────────────────────────────────────

function GridCard({
  project,
  onOpen,
  onRequestDelete,
}: {
  project: StudioProject;
  onOpen: () => void;
  onRequestDelete: () => void;
}) {
  const { colors, accent } = useTheme();
  const { t } = useTranslation('projects');
  const { width } = useWindowDimensions();
  // Two columns inside the 14pt list padding with a 12pt gutter.
  const cardWidth = (width - 14 * 2 - 12) / 2;
  const still = coverStill(project.cover, cardWidth);
  const thumbhash = project.cover?.thumbhash ?? undefined;

  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onRequestDelete}
      accessibilityRole="button"
      style={({ pressed }) => ({ width: cardWidth, marginHorizontal: 6, opacity: pressed ? 0.92 : 1 })}
    >
      <View style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: colors.surfaceMuted }}>
        <CoverThumb uri={still} thumbhash={thumbhash} recyclingKey={project.id} size={cardWidth} radius={0} />
        {(project.activeJobCount ?? 0) > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: 'rgba(0,0,0,0.45)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ActivityIndicator size="small" color={accent.solid} />
          </View>
        ) : null}
      </View>
      <Stack gap="xs" style={{ paddingHorizontal: 4, paddingTop: 8 }}>
        <Text variant="bodySemi" color="ink" numberOfLines={1}>
          {project.name}
        </Text>
        <HStack align="center" gap="xs">
          <OriginBadge origin={project.origin} />
          <Text variant="caption" color="inkMuted" numberOfLines={1}>
            {t('outputs', { count: project.assetCount })}
          </Text>
        </HStack>
      </Stack>
    </Pressable>
  );
}

/** The project's cover at a given square size — or the brand glyph when it has none. */
function CoverThumb({
  uri,
  thumbhash,
  recyclingKey,
  size,
  radius,
}: {
  uri?: string;
  thumbhash?: string;
  recyclingKey: string;
  size: number;
  radius: number;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: colors.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {uri || thumbhash ? (
        <Image
          source={uri}
          placeholder={thumbhash ? { thumbhash } : undefined}
          placeholderContentFit="cover"
          recyclingKey={recyclingKey}
          cachePolicy="memory-disk"
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <Icon name="sparkle" size={Math.max(18, size * 0.2)} color={colors.inkMuted} />
      )}
    </View>
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

function NoMatches({ onClear }: { onClear: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation('projects');
  return (
    <View
      style={{
        marginTop: 40,
        padding: 24,
        borderRadius: 22,
        backgroundColor: colors.surfaceMuted,
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Text variant="bodySemi" color="ink">
        {t('noMatchesTitle')}
      </Text>
      <Text variant="caption" color="inkMuted" align="center">
        {t('noMatchesDescription')}
      </Text>
      <Button variant="ghost" size="sm" onPress={onClear}>
        {t('clearFilters')}
      </Button>
    </View>
  );
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
