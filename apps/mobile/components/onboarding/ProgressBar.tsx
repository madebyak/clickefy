/**
 * Segmented progress bar for onboarding. N segments, the active one fills
 * with the brand accent, completed ones stay filled at full opacity, future
 * ones are a muted track.
 *
 * Pattern matches the Clubhouse reference (segments fill, no dots).
 */

import { useTheme } from '@clickfy/ui';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

interface ProgressBarProps {
  /** Current slide index (0-based) */
  current: number;
  /** Total slide count */
  total: number;
}

export function ProgressBar({ current, total }: ProgressBarProps) {
  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityValue={{ now: current + 1, min: 1, max: total }}>
      {Array.from({ length: total }, (_, i) => (
        <Segment key={i} index={i} current={current} />
      ))}
    </View>
  );
}

function Segment({ index, current }: { index: number; current: number }) {
  const { accent, colors } = useTheme();

  // Fill progress for this segment: 0 (future), 1 (active/done).
  const fill = useSharedValue(index <= current ? 1 : 0);

  useEffect(() => {
    fill.value = withTiming(index <= current ? 1 : 0, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [current, fill, index]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%`,
    opacity: fill.value,
  }));

  return (
    <View
      style={[
        styles.track,
        { backgroundColor: colors.borderStrong },
      ]}
    >
      <Animated.View
        style={[
          styles.fill,
          { backgroundColor: accent.solid },
          fillStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flex: 1,
    gap: 6,
    alignItems: 'center',
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});
