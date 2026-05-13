/**
 * FloatingDeck — the "big image" composition for an onboarding slide.
 *
 * Three layouts, each with a typed `sources` payload so the call-site
 * can't mix up which image goes where:
 *
 *   - `orbit` : { center, left, right }                       (slide 1)
 *   - `grid`  : { hero, thumbs: [a, b, c, d] }                (slide 2)
 *   - `stack` : { front, middle, back }  + showPlayBadge?     (slide 3)
 *
 * Each card does a subtle continuous Ken-Burns drift (scale 1.0 ↔ 1.04) so
 * the composition never feels static.
 */

import { useTheme } from '@clickfy/ui';
import { Image, type ImageSource } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';

export type DeckLayout = 'orbit' | 'grid' | 'stack';

export interface OrbitSources {
  center: ImageSourcePropType;
  left: ImageSourcePropType;
  right: ImageSourcePropType;
}

export interface GridSources {
  hero: ImageSourcePropType;
  thumbs: [
    ImageSourcePropType,
    ImageSourcePropType,
    ImageSourcePropType,
    ImageSourcePropType,
  ];
}

export interface StackSources {
  front: ImageSourcePropType;
  middle: ImageSourcePropType;
  back: ImageSourcePropType;
}

export type FloatingDeckProps =
  | { layout: 'orbit'; sources: OrbitSources }
  | { layout: 'grid'; sources: GridSources }
  | { layout: 'stack'; sources: StackSources; showPlayBadge?: boolean };

export function FloatingDeck(props: FloatingDeckProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.stage} accessibilityElementsHidden>
      <View
        style={[
          styles.backdrop,
          { backgroundColor: colors.surfaceMuted },
        ]}
      />

      {props.layout === 'orbit' && <OrbitLayout sources={props.sources} />}
      {props.layout === 'grid' && <GridLayout sources={props.sources} />}
      {props.layout === 'stack' && (
        <StackLayout sources={props.sources} showPlayBadge={props.showPlayBadge} />
      )}
    </View>
  );
}

// ─── Orbit ────────────────────────────────────────────────────────────

function OrbitLayout({ sources }: { sources: OrbitSources }) {
  return (
    <View style={styles.orbit}>
      <DriftCard
        source={sources.left}
        rotation={-10}
        driftAmount={0.025}
        style={{
          position: 'absolute',
          left: -28,
          top: 60,
          width: 132,
          height: 168,
          borderRadius: 20,
          zIndex: 1,
        }}
      />
      <DriftCard
        source={sources.right}
        rotation={9}
        driftAmount={0.025}
        driftDelay={500}
        style={{
          position: 'absolute',
          right: -28,
          top: 80,
          width: 132,
          height: 168,
          borderRadius: 20,
          zIndex: 1,
        }}
      />
      <DriftCard
        source={sources.center}
        rotation={-3}
        driftAmount={0.035}
        driftDelay={1000}
        style={{
          width: 200,
          height: 260,
          borderRadius: 24,
          zIndex: 2,
        }}
      />
    </View>
  );
}

// ─── Grid (bento) ─────────────────────────────────────────────────────

function GridLayout({ sources }: { sources: GridSources }) {
  const [a, b, c, d] = sources.thumbs;
  return (
    <View style={styles.grid}>
      <DriftCard
        source={sources.hero}
        driftAmount={0.02}
        style={{ width: 280, height: 140, borderRadius: 20 }}
      />
      <View style={styles.gridRow}>
        <DriftCard
          source={a}
          driftAmount={0.025}
          driftDelay={300}
          style={{ width: 132, height: 132, borderRadius: 18 }}
        />
        <DriftCard
          source={b}
          driftAmount={0.025}
          driftDelay={600}
          style={{ width: 132, height: 132, borderRadius: 18 }}
        />
      </View>
      <View style={styles.gridRow}>
        <DriftCard
          source={c}
          driftAmount={0.025}
          driftDelay={900}
          style={{ width: 132, height: 90, borderRadius: 18 }}
        />
        <DriftCard
          source={d}
          driftAmount={0.025}
          driftDelay={1200}
          style={{ width: 132, height: 90, borderRadius: 18 }}
        />
      </View>
    </View>
  );
}

// ─── Stack ────────────────────────────────────────────────────────────

function StackLayout({
  sources,
  showPlayBadge,
}: {
  sources: StackSources;
  showPlayBadge?: boolean;
}) {
  return (
    <View style={styles.stack}>
      <DriftCard
        source={sources.back}
        rotation={8}
        driftAmount={0.02}
        driftDelay={600}
        style={{
          position: 'absolute',
          right: -20,
          top: 50,
          width: 180,
          height: 230,
          borderRadius: 22,
          opacity: 0.95,
          zIndex: 1,
        }}
      />
      <DriftCard
        source={sources.middle}
        rotation={-6}
        driftAmount={0.025}
        driftDelay={300}
        style={{
          position: 'absolute',
          left: -16,
          top: 30,
          width: 180,
          height: 230,
          borderRadius: 22,
          zIndex: 2,
        }}
      />
      <View style={{ zIndex: 3 }}>
        <DriftCard
          source={sources.front}
          rotation={2}
          driftAmount={0.03}
          style={{
            width: 200,
            height: 260,
            borderRadius: 22,
          }}
        />
        {showPlayBadge ? <PlayBadge /> : null}
      </View>
    </View>
  );
}

function PlayBadge() {
  const { accent } = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        marginTop: -28,
        marginLeft: -28,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: accent.solid,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: accent.solid,
        shadowOpacity: 0.5,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      <Icon name="play" weight="fill" size={22} color={accent.ink} />
    </View>
  );
}

// ─── DriftCard ────────────────────────────────────────────────────────

interface DriftCardProps {
  source: ImageSourcePropType;
  rotation?: number;
  driftAmount?: number;
  driftDelay?: number;
  style?: React.ComponentProps<typeof Animated.View>['style'];
}

function DriftCard({
  source,
  rotation = 0,
  driftAmount = 0.03,
  driftDelay = 0,
  style,
}: DriftCardProps) {
  const scale = useSharedValue(1 - driftAmount / 2);

  useEffect(() => {
    const start = setTimeout(() => {
      scale.value = withRepeat(
        withTiming(1 + driftAmount / 2, {
          duration: 4200,
          easing: Easing.inOut(Easing.quad),
        }),
        -1,
        true,
      );
    }, driftDelay);
    return () => clearTimeout(start);
  }, [driftAmount, driftDelay, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation}deg` }, { scale: scale.value }],
  }));

  return (
    <Animated.View style={[cardStyles.card, style, animStyle]}>
      <Image
        source={source as ImageSource}
        contentFit="cover"
        transition={220}
        style={cardStyles.image}
      />
    </Animated.View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    backgroundColor: '#E8E4DA',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  image: {
    width: '100%',
    height: '100%',
  },
});

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingHorizontal: 20,
  },
  backdrop: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    top: '50%',
    marginTop: -170,
    opacity: 0.5,
  },
  orbit: {
    width: 320,
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  grid: {
    alignItems: 'center',
    gap: 14,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 14,
  },
  stack: {
    width: 320,
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
});
