/**
 * ProjectMasonry — the composer's ONE content surface: a two-column
 * masonry of generated media, whether the session is fresh (its own
 * generations) or a project is open (its assets + in-flight work).
 *
 * Cells deal into whichever column is currently shorter, keeping each
 * media's true aspect ratio — the stagger with no measurement pass.
 *
 * Cell states, mirroring the web workspace's pending strip:
 *   pending → pulsing skeleton card: spinner, Queued/Generating label,
 *             stage label, bottom progress bar — all in the mode color.
 *   failed  → warning + the server's sentence + a dismiss ✕.
 *   video   → AUTOPLAYING muted loop via VideoPreview (poster
 *             underneath, global decoder-slot limited), purple dot badge.
 *   image   → plain image.
 * Ready cells carry ↓ save and ⋯ details in the corner.
 */

import { accents, Pressable, Skeleton, Text, useTheme } from '@clickfy/ui';
import { Image } from 'expo-image';
import { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { LogoMark } from '@/components/brand/Logo';
import { VideoPreview } from '@/components/home/VideoPreview';
import { ErrorState } from '@/components/shared/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { outputThumbnailUrl } from '@/lib/image-url';
import { MODE_TINT } from './mode-colors';
import type { ComposerMode } from './sheets';

export interface MasonryCell {
  id: string;
  kind: ComposerMode;
  /** "3:4" etc — the cell's shape. */
  ratio: string;
  /** Still/poster source; absent while pending (and for posterless video). */
  uri?: string | number;
  /** ThumbHash painted before `uri` loads, or alone when there is no still. */
  thumbhash?: string;
  /**
   * What the grid autoplays for a finished video — the muted preview
   * rendition when the asset has one, else the original. Never used for
   * the viewer or Save to Photos, which read the asset's own URL.
   */
  videoUrl?: string;
  pending?: boolean;
  /** Pending detail, verbatim from the job poller. */
  pendingStatus?: 'queued' | 'processing';
  stageLabel?: string;
  /** 0–1 within the active stage. */
  stageProgress?: number;
  failed?: boolean;
  errorMessage?: string;
  /** A short tag in the top corner — "Draft" on a Draft-mode preview. */
  badge?: string;
}

export interface MasonryLabels {
  menu: string;
  download: string;
  queued: string;
  generating: string;
  failed: string;
  dismiss: string;
  emptyTitle: string;
  emptyBody: string;
  loadError: string;
}

/** Grid gutters: 16 each side, 10 between the two columns. */
const GRID_SIDE = 16;
const GRID_GAP = 10;

/** Skeleton shapes while a project's assets load — varied like real work. */
const LOADING_RATIOS = ['3:4', '1:1', '4:5', '16:9', '1:1', '3:4'];

function aspectValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number);
  return w && h ? w / h : 1;
}

export function ProjectMasonry({
  cells,
  labels,
  loading = false,
  error = null,
  onOpenCell,
  onCellMenu,
  onCellDownload,
  onDismissFailed,
}: {
  cells: MasonryCell[];
  labels: MasonryLabels;
  /** The open project's assets are still on their first fetch. */
  loading?: boolean;
  /** That fetch failed; `onRetry` re-runs it. */
  error?: { onRetry: () => void; retrying: boolean } | null;
  onOpenCell: (cell: MasonryCell) => void;
  onCellMenu: (cell: MasonryCell) => void;
  onCellDownload: (cell: MasonryCell) => void;
  onDismissFailed: (cell: MasonryCell) => void;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const cellWidth = (screenWidth - GRID_SIDE * 2 - GRID_GAP) / 2;

  // Balance by accumulated height so neither column runs long.
  const [colA, colB] = useMemo(() => {
    const a: MasonryCell[] = [];
    const b: MasonryCell[] = [];
    let ha = 0;
    let hb = 0;
    for (const cell of cells) {
      const cellH = 1 / aspectValue(cell.ratio);
      if (ha <= hb) {
        a.push(cell);
        ha += cellH;
      } else {
        b.push(cell);
        hb += cellH;
      }
    }
    return [a, b];
  }, [cells]);

  // The empty, loading and error states all ride INSIDE the scroll
  // surface (not a bare View): that's what makes a tap anywhere in an
  // empty project dismiss the keyboard exactly like a tap between cells
  // does. Session cells (a generation just submitted) always win over
  // the placeholder states, so a failed refetch never hides live work.
  if (cells.length === 0) {
    if (loading) {
      return (
        <ScrollView
          style={{ flex: 1 }}
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.grid}
        >
          <View style={styles.column}>
            {LOADING_RATIOS.filter((_, i) => i % 2 === 0).map((ratio, i) => (
              <Skeleton key={i} height={cellWidth / aspectValue(ratio)} radius={16} />
            ))}
          </View>
          <View style={styles.column}>
            {LOADING_RATIOS.filter((_, i) => i % 2 === 1).map((ratio, i) => (
              <Skeleton key={i} height={cellWidth / aspectValue(ratio)} radius={16} />
            ))}
          </View>
        </ScrollView>
      );
    }
    return (
      <ScrollView
        style={{ flex: 1 }}
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {error ? (
          <View style={styles.emptyWrap}>
            <ErrorState
              title={labels.loadError}
              onRetry={error.onRetry}
              retrying={error.retrying}
              style={{ alignSelf: 'stretch' }}
            />
          </View>
        ) : (
          <View style={styles.emptyWrap}>
            <LogoMark size={44} />
            <Text
              variant="display"
              color="ink"
              align="center"
              style={{ fontSize: 24, lineHeight: 31, letterSpacing: 0, maxWidth: 300, marginTop: 16 }}
            >
              {labels.emptyTitle}
            </Text>
            <Text variant="caption" color="inkMuted" align="center" style={{ maxWidth: 260, marginTop: 6 }}>
              {labels.emptyBody}
            </Text>
          </View>
        )}
      </ScrollView>
    );
  }

  const renderCell = (cell: MasonryCell) => (
    <Cell
      key={cell.id}
      cell={cell}
      labels={labels}
      thumbWidth={cellWidth}
      onOpen={() => onOpenCell(cell)}
      onMenu={() => onCellMenu(cell)}
      onDownload={() => onCellDownload(cell)}
      onDismiss={() => onDismissFailed(cell)}
    />
  );

  return (
    <ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      // Standard iOS manners: with the keyboard up, the FIRST tap on the
      // grid only dismisses it (no cell action fires), and starting a
      // scroll drags it away too.
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.grid}
    >
      <View style={styles.column}>{colA.map(renderCell)}</View>
      <View style={styles.column}>{colB.map(renderCell)}</View>
    </ScrollView>
  );
}

// ─── Cell ───────────────────────────────────────────────────────────

function Cell({
  cell,
  labels,
  thumbWidth,
  onOpen,
  onMenu,
  onDownload,
  onDismiss,
}: {
  cell: MasonryCell;
  labels: MasonryLabels;
  /** Layout width of the cell in dp — sizes the grid derivative requested. */
  thumbWidth: number;
  onOpen: () => void;
  onMenu: () => void;
  onDownload: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const interactive = !cell.pending && !cell.failed;

  return (
    <Pressable onPress={interactive ? onOpen : undefined} haptic="light" pressedOpacity={0.94}>
      <View
        style={{
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: colors.surface,
          aspectRatio: aspectValue(cell.ratio),
        }}
      >
        {cell.pending ? (
          <PendingSkeleton cell={cell} labels={labels} />
        ) : cell.failed ? (
          <View style={[styles.centerFill, { backgroundColor: colors.surfaceMuted }]}>
            <Icon name="warning" size={20} color={colors.inkMuted} />
            <Text
              variant="caption"
              color="inkMuted"
              align="center"
              numberOfLines={4}
              style={{ marginTop: 6, paddingHorizontal: 12 }}
            >
              {cell.errorMessage || labels.failed}
            </Text>
            <Pressable
              onPress={onDismiss}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel={labels.dismiss}
              style={[styles.cornerButton, { position: 'absolute', top: 8, right: 8 }]}
            >
              <Icon name="close" size={13} color="#FFFFFF" weight="bold" />
            </Pressable>
          </View>
        ) : (
          <>
            {cell.kind === 'video' && cell.videoUrl ? (
              // Autoplaying muted loop, poster underneath, capped by the
              // global decoder-slot limiter — the home feed's exact rig.
              <VideoPreview
                source={cell.videoUrl}
                posterUri={
                  typeof cell.uri === 'string'
                    ? outputThumbnailUrl(cell.uri, { width: thumbWidth })
                    : undefined
                }
                posterThumbhash={cell.thumbhash}
                contentFit="cover"
                cardId={cell.id}
                style={StyleSheet.absoluteFill}
              />
            ) : cell.uri || cell.thumbhash ? (
              // Grid derivative only — the viewer and Save to Photos read
              // the untouched original off the asset row.
              <Image
                source={
                  typeof cell.uri === 'string'
                    ? outputThumbnailUrl(cell.uri, { width: thumbWidth })
                    : cell.uri
                }
                placeholder={cell.thumbhash ? { thumbhash: cell.thumbhash } : undefined}
                placeholderContentFit="cover"
                recyclingKey={cell.id}
                cachePolicy="memory-disk"
                contentFit="cover"
                style={{ width: '100%', height: '100%' }}
                transition={150}
              />
            ) : (
              <View style={{ width: '100%', height: '100%', backgroundColor: '#101019' }} />
            )}
            {cell.kind === 'video' ? (
              <View style={styles.videoBadge}>
                <View style={[styles.modeDot, { backgroundColor: MODE_TINT.video.solid }]} />
              </View>
            ) : null}
            {cell.badge ? (
              <View style={[styles.tagBadge, { backgroundColor: accents.violet.solid }]}>
                <Text variant="caption" weight="700" style={{ color: accents.violet.ink, fontSize: 10, lineHeight: 14 }}>
                  {cell.badge}
                </Text>
              </View>
            ) : null}
            {/* ↓ save + ⋯ details, stacked in the corner. */}
            <View style={styles.cornerActions}>
              <Pressable
                onPress={onDownload}
                haptic="light"
                pressedOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={labels.download}
                style={styles.cornerButton}
              >
                <Icon name="download" size={13} color="#FFFFFF" weight="bold" />
              </Pressable>
              <Pressable
                onPress={onMenu}
                haptic="light"
                pressedOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={labels.menu}
                style={styles.cornerButton}
              >
                <Icon name="more" size={14} color="#FFFFFF" weight="bold" />
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Pressable>
  );
}

// ─── Pending skeleton (mirrors web's PendingStrip tile) ─────────────

function PendingSkeleton({ cell, labels }: { cell: MasonryCell; labels: MasonryLabels }) {
  const { colors } = useTheme();
  const tint = MODE_TINT[cell.kind];

  // The web tile pulses the whole card; same rhythm here.
  const pulse = useSharedValue(0.55);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[styles.centerFill, { backgroundColor: colors.surfaceMuted, gap: 8 }, pulseStyle]}
    >
      <ActivityIndicator size="small" color={tint.solid} />
      <Text variant="caption" color="ink" weight="700">
        {cell.pendingStatus === 'queued' ? labels.queued : labels.generating}
      </Text>
      {cell.stageLabel ? (
        <Text variant="caption" color="inkMuted" numberOfLines={1} style={{ paddingHorizontal: 12 }}>
          {cell.stageLabel}
        </Text>
      ) : null}
      {cell.pendingStatus === 'processing' && typeof cell.stageProgress === 'number' ? (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: tint.solid, width: `${Math.round(cell.stageProgress * 100)}%` },
            ]}
          />
        </View>
      ) : null}
    </Animated.View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    gap: GRID_GAP,
    paddingHorizontal: GRID_SIDE,
    paddingTop: 8,
    paddingBottom: 16,
  },
  column: {
    flex: 1,
    gap: GRID_GAP,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  centerFill: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  modeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cornerActions: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 6,
  },
  cornerButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
});
