import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Pressable } from '../primitives/Pressable';
import { useTheme } from '../theme/ThemeProvider';

export interface SwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  /** Use the active accent color when on. Default: true. */
  accent?: boolean;
}

const TRACK_W = 44;
const TRACK_H = 26;
const THUMB = 22;

/**
 * Switch — themed toggle. iOS-style sliding thumb with spring physics.
 * Used for: dark mode toggle in hamburger drawer, settings toggles.
 */
export function Switch({ value, onValueChange, disabled, accent = true }: SwitchProps) {
  const theme = useTheme();
  const offset = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    offset.value = withSpring(value ? 1 : 0, theme.spring);
  }, [value, offset, theme.spring]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value * (TRACK_W - THUMB - 4) }],
  }));

  const trackStyle = useAnimatedStyle(() => {
    const onColor = accent ? theme.accent.solid : theme.colors.success;
    return {
      backgroundColor: value ? onColor : theme.colors.borderStrong,
      opacity: 1 - offset.value * 0.0,
    };
  });

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      haptic="selection"
      pressedOpacity={0.85}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
    >
      <Animated.View
        style={[
          {
            width: TRACK_W,
            height: TRACK_H,
            borderRadius: TRACK_H / 2,
            justifyContent: 'center',
            paddingHorizontal: 2,
            opacity: disabled ? 0.4 : 1,
          },
          trackStyle,
        ]}
      >
        <Animated.View
          style={[
            {
              width: THUMB,
              height: THUMB,
              borderRadius: THUMB / 2,
              backgroundColor: '#FFFFFF',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.2,
              shadowRadius: 3,
              elevation: 2,
            },
            thumbStyle,
          ]}
        />
        <View style={{ width: 0, height: 0 }} />
      </Animated.View>
    </Pressable>
  );
}
