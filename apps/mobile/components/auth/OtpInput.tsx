/**
 * OtpInput — six-cell one-time-code input with auto-advance, paste, and
 * iOS / Android SMS auto-fill.
 *
 * Implementation pattern:
 *   - One hidden `<TextInput>` is the source of truth for the value (and
 *     receives the OS auto-fill suggestion via `textContentType` /
 *     `autoComplete`). Six visual cells render the i-th character on top.
 *   - Tapping any cell focuses the hidden input.
 *   - Numeric-only sanitisation happens in `onChangeText` — paste-with-digits
 *     "just works" because RN delivers paste as a single change event.
 *   - When the value reaches `length`, `onComplete` fires automatically.
 *
 * Why one hidden input instead of N visible inputs:
 *   - SMS auto-fill on iOS only targets one focused input.
 *   - Multi-input pattern fights the keyboard's word-suggestion bar.
 *   - Cursor management with N inputs is fragile across iOS/Android.
 */

import { useTheme } from '@clickfy/ui';
import { useEffect, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { tap } from '@/lib/haptics';

const CELL_WIDTH = 48;
const CELL_HEIGHT = 56;
const CELL_GAP = 10;

export interface OtpInputProps {
  /** Number of cells. Default 6. */
  length?: number;
  value: string;
  onChange: (val: string) => void;
  /** Fires once when value length === length. */
  onComplete?: (val: string) => void;
  /** Render cells in an error state (red border + shake). */
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  error = false,
  disabled = false,
  autoFocus = true,
}: OtpInputProps) {
  const { colors, accent } = useTheme();
  const inputRef = useRef<TextInput>(null);

  // Horizontal shake when `error` toggles to true.
  const shakeX = useSharedValue(0);
  useEffect(() => {
    if (error) {
      tap('error');
      shakeX.value = withSequence(
        withTiming(-8, { duration: 60, easing: Easing.out(Easing.quad) }),
        withRepeat(
          withTiming(8, { duration: 80, easing: Easing.inOut(Easing.quad) }),
          3,
          true,
        ),
        withTiming(0, { duration: 60, easing: Easing.out(Easing.quad) }),
      );
    }
  }, [error, shakeX]);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const handleChange = (text: string) => {
    if (disabled) return;
    const next = text.replace(/\D/g, '').slice(0, length);
    onChange(next);
    if (next.length === length) {
      tap('selection');
      onComplete?.(next);
    } else if (next.length > value.length) {
      // User added a digit — soft tick to confirm.
      tap('selection');
    }
  };

  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key === 'Backspace' && value.length > 0) {
      tap('selection');
    }
  };

  const focus = () => {
    if (disabled) return;
    inputRef.current?.focus();
  };

  return (
    <Pressable
      onPress={focus}
      accessibilityRole="button"
      accessibilityLabel="One-time code input"
      accessibilityHint={`Enter the ${length}-digit code we sent to your email.`}
    >
      <Animated.View style={[styles.row, shakeStyle]}>
        {Array.from({ length }, (_, i) => {
          const char = value[i] ?? '';
          const isCurrent = i === Math.min(value.length, length - 1);
          const isFilled = char !== '';
          const borderColor = error
            ? colors.danger
            : isCurrent || isFilled
              ? accent.solid
              : colors.border;

          return (
            <View
              key={i}
              style={[
                styles.cell,
                {
                  backgroundColor: colors.surface,
                  borderColor,
                  borderWidth: isCurrent || isFilled ? 1.5 : 1,
                },
              ]}
            >
              <Animated.Text
                style={[
                  styles.cellText,
                  { color: error ? colors.danger : colors.ink },
                ]}
              >
                {char}
              </Animated.Text>
              {/* Cursor pulse on the active empty cell */}
              {isCurrent && !isFilled && !disabled && !error ? (
                <Caret color={accent.solid} />
              ) : null}
            </View>
          );
        })}
      </Animated.View>

      {/* Hidden source-of-truth input. */}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        onKeyPress={handleKeyPress}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        importantForAutofill="yes"
        autoFocus={autoFocus}
        editable={!disabled}
        caretHidden
        maxLength={length}
        style={styles.hiddenInput}
      />
    </Pressable>
  );
}

function Caret({ color }: { color: string }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0, { duration: 540, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: 2,
          height: 26,
          backgroundColor: color,
          borderRadius: 1,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: CELL_GAP,
    justifyContent: 'center',
  },
  cell: {
    width: CELL_WIDTH,
    height: CELL_HEIGHT,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: {
    fontFamily: 'Geist_700Bold',
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.6,
    includeFontPadding: false,
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: CELL_HEIGHT,
    opacity: 0,
    // Width 100% + opacity 0 keeps the input hittable so paste from the
    // keyboard suggestion bar can still target it.
  },
});
