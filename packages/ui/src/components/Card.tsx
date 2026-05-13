import { type ViewStyle } from 'react-native';

import { Box, type BoxProps } from '../primitives/Box';
import { Pressable, type HapticType } from '../primitives/Pressable';

export interface CardProps extends Omit<BoxProps, 'bg' | 'border' | 'radius'> {
  /** Visual elevation: `flat` (no shadow), `raised` (subtle shadow). */
  elevation?: 'flat' | 'raised';
  /** Optional press handler — converts to a Pressable */
  onPress?: () => void;
  haptic?: HapticType;
  /** Override surface color */
  surface?: 'surface' | 'surfaceElev' | 'surfaceMuted';
  /** Override radius preset */
  radius?: 'md' | 'lg' | 'card' | 'xl' | 'xxl';
  /** Toggle border */
  bordered?: boolean;
}

/**
 * Card — themed surface container with sensible defaults.
 * Press makes it a Pressable with light haptic.
 */
export function Card({
  elevation = 'flat',
  onPress,
  haptic = 'light',
  surface = 'surface',
  radius = 'card',
  bordered = true,
  p = 'base',
  children,
  style,
  ...rest
}: CardProps) {
  const shadow: ViewStyle =
    elevation === 'raised'
      ? {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.08,
          shadowRadius: 22,
          elevation: 4,
        }
      : {};

  const inner = (
    <Box
      bg={surface}
      border={bordered ? 'border' : undefined}
      radius={radius}
      p={p}
      {...rest}
      style={style ? [shadow, style as ViewStyle] : shadow}
    >
      {children}
    </Box>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} haptic={haptic} pressedOpacity={0.92}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}
