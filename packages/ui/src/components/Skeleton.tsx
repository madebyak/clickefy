import { useEffect } from 'react';
import { type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../theme/ThemeProvider';

export interface SkeletonProps {
  width?: ViewStyle['width'];
  height?: ViewStyle['height'];
  /** Border radius — number or theme key */
  radius?: number;
  style?: ViewStyle;
}

/**
 * Skeleton — animated shimmer placeholder for loading states.
 * Always pair with `aspectRatio` or fixed dimensions to avoid layout jumps.
 */
export function Skeleton({ width = '100%', height = 16, radius = 8, style }: SkeletonProps) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          backgroundColor: colors.surfaceMuted,
          borderRadius: radius,
        },
        animated,
        style,
      ]}
    />
  );
}
