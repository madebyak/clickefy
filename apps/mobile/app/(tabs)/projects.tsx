import { Badge, Box, Button, Card, HStack, Skeleton, Stack, Text, useTheme } from '@clickfy/ui';
import type { UserProject } from '@clickfy/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
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

import { Icon } from '@/components/ui/Icon';
import { setGenerationOutputs } from '@/lib/generation-cache';
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
  const sdk = getSDK();
  const qc = useQueryClient();

  // Track the most-recently-opened swipeable so opening a new one
  // closes the previous one. Mirrors iOS Mail's "only one row at
  // a time" behaviour — without it the UI feels chaotic.
  const openRowRef = useRef<SwipeableMethods | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => sdk.library.listProjects({ limit: 30 }),
    ...PROJECTS_QUERY,
  });

  // Refetch when the user tabs back to this screen. The initial mount
  // fetch is handled by React-Query itself; this hook only fires on
  // subsequent focuses. Pull-to-refresh below covers the explicit
  // "force me a fresh copy" gesture.
  useRefreshOnFocus(projectsQuery.refetch);

  const deleteMutation = useMutation({
    mutationFn: (jobId: string) => sdk.library.deleteProject(jobId),
    onMutate: async (jobId) => {
      await qc.cancelQueries({ queryKey: ['projects'] });
      const previous = qc.getQueryData<{ items: UserProject[]; nextCursor: string | null }>([
        'projects',
      ]);
      // Optimistic remove. Keep the rest of the page intact.
      qc.setQueryData(['projects'], (old: { items: UserProject[]; nextCursor: string | null } | undefined) =>
        old
          ? { ...old, items: old.items.filter((p) => p.id !== jobId) }
          : old,
      );
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return { previous };
    },
    onError: (_err, _jobId, ctx) => {
      // Roll back — the network call failed but the user already
      // saw the row vanish. Restoring keeps the list honest.
      if (ctx?.previous) qc.setQueryData(['projects'], ctx.previous);
      Alert.alert(
        'Could not delete',
        'We couldn\u2019t remove that project. Check your connection and try again.',
      );
    },
    onSettled: () => {
      // The list mutation interacts with credit_ledger FKs server-side
      // (ON DELETE SET NULL). A background refetch keeps us aligned
      // even if the optimistic update drifted.
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const items = projectsQuery.data?.items ?? [];

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
        'Delete this project?',
        'It will be removed from your history. Generated images stay accessible through any direct links you\u2019ve already shared.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => openRowRef.current?.close() },
          {
            text: 'Delete',
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
    [deleteMutation],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 16 }}>
      <Box px="lg" pb="md">
        <Stack gap="sm">
          <Text variant="overline" color="inkMuted" transform="uppercase">
            Your work
          </Text>
          <Text variant="title" color="ink">
            Projects
          </Text>
        </Stack>
      </Box>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            // `isRefetching` is true for both initial mount fetches
            // and subsequent refetches. We gate on `!isLoading` so
            // the spinner only shows for explicit refreshes — the
            // first-paint case has its own skeleton row.
            refreshing={projectsQuery.isRefetching && !projectsQuery.isLoading}
            onRefresh={() => void projectsQuery.refetch()}
            tintColor={colors.inkMuted}
          />
        }
      >
        {projectsQuery.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={86} radius={18} />)
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          items.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              onOpen={() => handleOpenProject(p)}
              onRequestDelete={() => handleConfirmDelete(p)}
              registerOpenRow={(row) => {
                // Auto-close any previously-open row on a new swipe.
                if (openRowRef.current && openRowRef.current !== row) {
                  openRowRef.current.close();
                }
                openRowRef.current = row;
              }}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
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
  const { colors } = useTheme();
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
                source={project.outputs[0]?.url ?? project.templateCoverImage ?? undefined}
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
                <Text variant="caption" color="inkMuted">
                  {project.whenLabel}
                </Text>
                {project.status === 'ready' ? (
                  <>
                    <Dot color={colors.inkSubtle} />
                    <Text variant="caption" color="inkMuted">
                      {project.count} output{project.count === 1 ? '' : 's'}
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
          paddingLeft: 12,
        },
        animatedStyle,
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Delete project"
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

function StatusBadge({ status }: { status: 'queued' | 'processing' | 'failed' }) {
  const tone = status === 'failed' ? 'danger' : 'neutral';
  const label = status === 'queued' ? 'Queued' : status === 'processing' ? 'Generating' : 'Failed';
  return <Badge label={label} tone={tone as 'danger' | 'neutral'} />;
}

function EmptyState() {
  const router = useRouter();
  const { colors } = useTheme();
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
        No projects yet
      </Text>
      <Text variant="caption" color="inkMuted" align="center">
        Generate your first image from a template and it&apos;ll show up here.
      </Text>
      <Button variant="accent" size="md" onPress={() => router.push('/(tabs)' as any)}>
        Browse templates
      </Button>
    </View>
  );
}
