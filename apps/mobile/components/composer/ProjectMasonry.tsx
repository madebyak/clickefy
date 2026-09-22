/**
 * ProjectMasonry — an open project's media in the composer's content
 * area, the mobile echo of the web studio workspace: a two-column
 * masonry where every cell keeps its media's true aspect ratio.
 *
 * Cells deal into whichever column is currently shorter, which gives
 * the stagger without a measurement pass. A cell can be PENDING (a
 * generation running inside this project): it renders the same
 * mode-tinted shimmer as the chat feed and resolves in place.
 */

import { Pressable, useTheme } from '@clickfy/ui';
import { Image } from 'expo-image';
import { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { MODE_TINT } from './mode-colors';
import type { ComposerMode } from './sheets';

export interface MasonryCell {
  id: string;
  kind: ComposerMode;
  /** "3:4" etc — the cell's shape. */
  ratio: string;
  /** Media source; absent while `pending`. */
  uri?: string | number;
  pending?: boolean;
}

function aspectValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number);
  return w && h ? w / h : 1;
}

export function ProjectMasonry({
  cells,
  onOpenCell,
  onCellMenu,
  menuLabel,
}: {
  cells: MasonryCell[];
  onOpenCell: (cell: MasonryCell) => void;
  onCellMenu: (cell: MasonryCell) => void;
  menuLabel: string;
}) {
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

  return (
    <ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
      }}
    >
      <View style={{ flex: 1, gap: 10 }}>
        {colA.map((cell) => (
          <Cell key={cell.id} cell={cell} menuLabel={menuLabel} onOpen={() => onOpenCell(cell)} onMenu={() => onCellMenu(cell)} />
        ))}
      </View>
      <View style={{ flex: 1, gap: 10 }}>
        {colB.map((cell) => (
          <Cell key={cell.id} cell={cell} menuLabel={menuLabel} onOpen={() => onOpenCell(cell)} onMenu={() => onCellMenu(cell)} />
        ))}
      </View>
    </ScrollView>
  );
}

function Cell({
  cell,
  menuLabel,
  onOpen,
  onMenu,
}: {
  cell: MasonryCell;
  menuLabel: string;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={cell.pending ? undefined : onOpen} haptic="light" pressedOpacity={0.94}>
      <View
        style={{
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: colors.surface,
          aspectRatio: aspectValue(cell.ratio),
        }}
      >
        {cell.pending ? (
          <Shimmer tint={MODE_TINT[cell.kind].solid} />
        ) : (
          <>
            <Image source={cell.uri} contentFit="cover" style={{ width: '100%', height: '100%' }} transition={150} />
            {cell.kind === 'video' ? (
              <View style={styles.playBadge}>
                <Icon name="play" size={11} color="#FFFFFF" weight="fill" />
                <View style={[styles.modeDot, { backgroundColor: MODE_TINT.video.solid }]} />
              </View>
            ) : null}
            {/* ⋯ — the asset's detail drawer (web's info panel). */}
            <Pressable
              onPress={onMenu}
              haptic="light"
              pressedOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={menuLabel}
              style={styles.menuButton}
            >
              <Icon name="more" size={14} color="#FFFFFF" weight="bold" />
            </Pressable>
          </>
        )}
      </View>
    </Pressable>
  );
}

function Shimmer({ tint }: { tint: string }) {
  const { colors } = useTheme();
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.75, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View
      style={{
        ...StyleSheet.absoluteFill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceMuted,
      }}
    >
      <Animated.View style={style}>
        <Icon name="sparkle" size={22} color={tint} weight="fill" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  playBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  menuButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
