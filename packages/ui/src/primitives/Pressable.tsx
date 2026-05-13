import * as Haptics from 'expo-haptics';
import { forwardRef, useCallback } from 'react';
import {
  Pressable as RNPressable,
  type GestureResponderEvent,
  type PressableProps as RNPressableProps,
  type View,
} from 'react-native';

export type HapticType = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error' | 'none';

export interface PressableProps extends Omit<RNPressableProps, 'children'> {
  children?: RNPressableProps['children'];
  /** Haptic feedback fired on press-in. Default: `light`. */
  haptic?: HapticType;
  /** Visual press feedback strength (opacity dimming). 0–1, default 0.6. */
  pressedOpacity?: number;
}

const fire = (type: HapticType) => {
  switch (type) {
    case 'light':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case 'medium':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'heavy':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      break;
    case 'selection':
      void Haptics.selectionAsync();
      break;
    case 'success':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case 'warning':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case 'error':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
    case 'none':
    default:
      break;
  }
};

/**
 * Pressable — RN Pressable with built-in haptic feedback + opacity press state.
 * Replaces TouchableOpacity (which is deprecated in favor of Pressable).
 */
export const Pressable = forwardRef<View, PressableProps>(function Pressable(
  { haptic = 'light', pressedOpacity = 0.6, onPressIn, style, children, ...rest },
  ref,
) {
  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      if (haptic !== 'none') fire(haptic);
      onPressIn?.(e);
    },
    [haptic, onPressIn],
  );

  return (
    <RNPressable
      ref={ref}
      {...rest}
      onPressIn={handlePressIn}
      style={(state) => {
        const userStyle =
          typeof style === 'function' ? style(state) : style;
        return [
          { opacity: state.pressed ? pressedOpacity : 1 },
          userStyle,
        ];
      }}
    >
      {children}
    </RNPressable>
  );
});
