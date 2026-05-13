/**
 * Splash — animated brand reveal that plays once on cold start.
 *
 * Composition:
 *   - Three vertical columns of product thumbnails scrolling in opposite
 *     directions at staggered offsets, dimmed so they read as ambience.
 *   - Each column slides up from off-screen with a cascading delay, then
 *     transitions into a continuous infinite scroll (seamless loop via a
 *     2× image set).
 *   - On top: the official "Clickefy.Ai" SVG logo scales in with a spring,
 *     coupled with a short haptic choreography (selection ticks during
 *     the rise, a medium tick when the logo lands).
 *
 * Total runtime ≈ 1.5 s. Reduce Motion collapses everything to a single
 * fade + success haptic.
 *
 * Why columns instead of static art:
 *   - Conveys what the app does (a catalog of generated assets) before the
 *     user has seen a single screen of UI.
 *   - Re-uses the onboarding image bundle — zero new assets needed.
 *   - The motion gives the splash personality while the logo stays the
 *     stable focal point.
 */

import { useTheme } from '@clickfy/ui';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  type ImageSourcePropType,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Logo } from '@/components/brand/Logo';
import { choreograph, type ChoreographStep } from '@/lib/haptics';

// ─── Timing ──────────────────────────────────────────────────────────
// Tuned so total runtime is ≈ 1.5 s.
const LOGO_RISE_MS = 540;
const LOGO_HOLD_MS = 520;
const FADE_OUT_MS = 280;

const REDUCED_FADE_IN_MS = 240;
const REDUCED_HOLD_MS = 320;
const REDUCED_FADE_OUT_MS = 220;

// Haptic beat sequence during the rise (4 selection ticks, then a medium
// tick aligned with the logo settling at full scale).
const RISE_HAPTIC_TICKS = 4;

// ─── Column layout ───────────────────────────────────────────────────
const COL_WIDTH = 116;
const CARD_HEIGHT = 144;
const CARD_RADIUS = 18;
const CARD_GAP = 10;
const STRIDE = CARD_HEIGHT + CARD_GAP;
const SET_SIZE = 6;
const HALF_HEIGHT = STRIDE * SET_SIZE; // distance a column must travel before its duplicated content overlaps the start position

// Image pool — sourced from the bundled onboarding assets so the splash
// loads instantly (no remote fetches, no flash of empty cards).
const POOL: ImageSourcePropType[] = [
  require('../assets/onboarding/slide-1-center.png'),
  require('../assets/onboarding/slide-1-left.png'),
  require('../assets/onboarding/slide-1-right.png'),
  require('../assets/onboarding/slide-2-hero.png'),
  require('../assets/onboarding/slide-2-a.png'),
  require('../assets/onboarding/slide-2-b.jpg'),
  require('../assets/onboarding/slide-2-c.jpg'),
  require('../assets/onboarding/slide-2-d.jpg'),
  require('../assets/onboarding/slide-3-front.jpg'),
  require('../assets/onboarding/slide-3-middle.jpg'),
  require('../assets/onboarding/slide-3-back.jpg'),
];

/** Return SET_SIZE images from the pool, starting at `seed`, picking with stride to avoid neighbours repeating. */
function pickColumn(seed: number): ImageSourcePropType[] {
  return Array.from({ length: SET_SIZE }, (_, i) => POOL[(seed + i * 3) % POOL.length]!);
}

const COL_1_IMAGES = pickColumn(0);
const COL_2_IMAGES = pickColumn(4);
const COL_3_IMAGES = pickColumn(8);

interface SplashProps {
  /** Called after the fade-out completes — parent should unmount the component. */
  onComplete: () => void;
}

export function Splash({ onComplete }: SplashProps) {
  const { colors, scheme } = useTheme();

  // Start at full opacity so we cover the navigator instantly when the
  // native splash hides — no flash of underlying content.
  const containerOpacity = useSharedValue(1);
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.86);

  useEffect(() => {
    let cancelChoreography: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
      if (cancelled) return;

      if (reduceMotion) {
        logoOpacity.value = withTiming(1, {
          duration: REDUCED_FADE_IN_MS,
          easing: Easing.out(Easing.cubic),
        });
        logoScale.value = withTiming(1, {
          duration: REDUCED_FADE_IN_MS,
          easing: Easing.out(Easing.cubic),
        });

        const fadeStart = REDUCED_FADE_IN_MS + REDUCED_HOLD_MS;
        containerOpacity.value = withDelay(
          fadeStart,
          withTiming(
            0,
            { duration: REDUCED_FADE_OUT_MS, easing: Easing.out(Easing.cubic) },
            (finished) => {
              if (finished) runOnJS(onComplete)();
            },
          ),
        );

        cancelChoreography = choreograph([{ at: REDUCED_FADE_IN_MS, kind: 'success' }]);
        return;
      }

      // Full choreography path — logo eases in (opacity) while a spring
      // settles its scale to 1.
      logoOpacity.value = withTiming(1, {
        duration: LOGO_RISE_MS,
        easing: Easing.out(Easing.cubic),
      });
      logoScale.value = withSpring(1, {
        damping: 14,
        stiffness: 160,
        mass: 0.7,
        overshootClamping: false,
      });

      const fadeStart = LOGO_RISE_MS + LOGO_HOLD_MS;
      containerOpacity.value = withDelay(
        fadeStart,
        withTiming(
          0,
          { duration: FADE_OUT_MS, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(onComplete)();
          },
        ),
      );

      // Haptic choreography — selection ticks staggered through the rise,
      // medium tick aligned with the spring settle.
      const steps: ChoreographStep[] = Array.from(
        { length: RISE_HAPTIC_TICKS },
        (_, i) => ({
          at: 80 + (i * LOGO_RISE_MS) / RISE_HAPTIC_TICKS,
          kind: 'selection' as const,
        }),
      );
      steps.push({ at: LOGO_RISE_MS + 60, kind: 'medium' });
      cancelChoreography = choreograph(steps);
    })();

    return () => {
      cancelled = true;
      cancelChoreography?.();
    };
  }, [containerOpacity, logoOpacity, logoScale, onComplete]);

  const containerStyle = useAnimatedStyle(() => ({ opacity: containerOpacity.value }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        styles.container,
        { backgroundColor: colors.bg },
        containerStyle,
      ]}
    >
      {/* ─── Scrolling image columns ─── */}
      <Animated.View
        style={[
          styles.columnsRow,
          { opacity: scheme === 'dark' ? 0.42 : 0.38 },
        ]}
      >
        <ImageColumn
          images={COL_1_IMAGES}
          startOffset={0}
          duration={22_000}
          direction="up"
          enterDelay={0}
        />
        <ImageColumn
          images={COL_2_IMAGES}
          startOffset={-(STRIDE * 1.5)}
          duration={28_000}
          direction="down"
          enterDelay={90}
        />
        <ImageColumn
          images={COL_3_IMAGES}
          startOffset={-(STRIDE * 3)}
          duration={24_000}
          direction="up"
          enterDelay={180}
        />
      </Animated.View>

      {/* ─── Logo ─── */}
      <Animated.View style={[styles.logoWrap, logoStyle]}>
        <Logo width={220} />
      </Animated.View>
    </Animated.View>
  );
}

// ─── ImageColumn ─────────────────────────────────────────────────────
// Cascading slide-in from off-screen → continuous infinite scroll.

interface ImageColumnProps {
  images: ImageSourcePropType[];
  /** Where the column should settle after the entrance animation. */
  startOffset: number;
  /** Duration of one full loop (ms). Lower = faster. */
  duration: number;
  /** Scroll direction. */
  direction: 'up' | 'down';
  /** Delay before the entrance animation begins (used to stagger columns). */
  enterDelay: number;
}

function ImageColumn({
  images,
  startOffset,
  duration,
  direction,
  enterDelay,
}: ImageColumnProps) {
  // Begin off-screen in the direction of travel so the entrance feels like
  // the column is sliding into place from where it'll continue going.
  const initialY = direction === 'up' ? startOffset + 240 : startOffset - 240;
  const ty = useSharedValue(initialY);

  useEffect(() => {
    const continuousTarget =
      direction === 'up' ? startOffset - HALF_HEIGHT : startOffset + HALF_HEIGHT;

    ty.value = withDelay(
      enterDelay,
      withSequence(
        // Entrance — ease into the start position.
        withTiming(startOffset, {
          duration: 540,
          easing: Easing.out(Easing.cubic),
        }),
        // Continuous loop — duplicated image set makes the reset seamless.
        withRepeat(
          withTiming(continuousTarget, {
            duration,
            easing: Easing.linear,
          }),
          -1,
          false,
        ),
      ),
    );
  }, [direction, duration, enterDelay, startOffset, ty]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
  }));

  // Render the image set twice so the seam between iterations isn't visible.
  const doubled = [...images, ...images];

  return (
    <Animated.View style={[styles.column, animStyle]}>
      {doubled.map((src, i) => (
        <Image
          key={i}
          source={src}
          contentFit="cover"
          style={styles.card}
          // Allow expo-image to decode in the background — splash should
          // never block on image work.
          priority="high"
          cachePolicy="memory-disk"
        />
      ))}
    </Animated.View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    overflow: 'hidden',
  },
  columnsRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 4,
  },
  column: {
    width: COL_WIDTH,
  },
  card: {
    width: COL_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: CARD_RADIUS,
    marginBottom: CARD_GAP,
    backgroundColor: '#E8E4DA',
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
