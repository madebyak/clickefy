/**
 * Toast — lightweight, non-blocking transient notifications.
 *
 * Why custom and not `react-native-toast-message`:
 *   • That library renders outside the GestureHandler/SafeArea tree on
 *     iOS modals, which already broke the paywall and result screens
 *     in earlier prototypes.
 *   • We need 3 tones (info / success / error) and one variant — extra
 *     surface area would have to be themed anyway.
 *   • Reanimated is already a transitive dep, and the implementation
 *     fits in ~150 lines.
 *
 * Apple HIG and Material both define "transient feedback" for
 * non-blocking confirmations (file saved, link copied, mutation
 * succeeded). `Alert.alert` is reserved for destructive confirms or
 * actions that *must* be acknowledged. This module is the home for
 * the former. The latter continues to use `Alert.alert`.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Saved to camera roll');
 *   toast.error('Couldn\'t download');
 *
 * Stacking semantics: only one toast is visible at a time. A new
 * `show()` cancels any pending dismiss and re-animates. This matches
 * iOS HUD behaviour ("the most recent message wins").
 */

import { Text, useTheme } from '@clickfy/ui';
import { useTranslation } from 'react-i18next';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui/Icon';

type ToastTone = 'info' | 'success' | 'error';

interface ToastPayload {
  id: number;
  tone: ToastTone;
  message: string;
  /** Optional secondary line for context (e.g. error detail). */
  detail?: string;
  /** How long to show. Default 2400 ms (iOS HUD style). */
  durationMs?: number;
}

interface ToastApi {
  show: (
    message: string,
    opts?: { tone?: ToastTone; detail?: string; durationMs?: number },
  ) => void;
  info: (message: string, detail?: string) => void;
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
  dismiss: () => void;
}

const DEFAULT_DURATION_MS = 2400;
const TOAST_ICON: Record<ToastTone, IconName> = {
  info: 'info',
  success: 'check',
  error: 'warning',
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastPayload | null>(null);
  const idRef = useRef(0);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The translate-Y shared value plus opacity drive a tiny slide-down.
  const offset = useSharedValue(-24);
  const opacity = useSharedValue(0);

  const clearTimer = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  }, []);

  const animateIn = useCallback(() => {
    offset.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
    opacity.value = withTiming(1, { duration: 200 });
  }, [offset, opacity]);

  const animateOutThenClear = useCallback(() => {
    offset.value = withTiming(-24, { duration: 180, easing: Easing.in(Easing.cubic) });
    opacity.value = withTiming(0, { duration: 180 }, (finished) => {
      if (finished) {
        // Drop the payload after the animation completes so the
        // host node unmounts cleanly (no flash of empty card).
      }
    });
    // RN reanimated's worklet callback fires on the UI thread —
    // hop back to JS via setTimeout to clear state safely.
    setTimeout(() => setCurrent(null), 200);
  }, [offset, opacity]);

  const dismiss = useCallback(() => {
    clearTimer();
    animateOutThenClear();
  }, [animateOutThenClear, clearTimer]);

  const show = useCallback<ToastApi['show']>(
    (message, opts) => {
      const payload: ToastPayload = {
        id: ++idRef.current,
        tone: opts?.tone ?? 'info',
        message,
        detail: opts?.detail,
        durationMs: opts?.durationMs ?? DEFAULT_DURATION_MS,
      };
      clearTimer();
      setCurrent(payload);
      animateIn();
      dismissTimer.current = setTimeout(() => {
        animateOutThenClear();
      }, payload.durationMs);
    },
    [animateIn, animateOutThenClear, clearTimer],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      info: (message, detail) => show(message, { tone: 'info', detail }),
      success: (message, detail) => show(message, { tone: 'success', detail }),
      error: (message, detail) =>
        // Errors get a longer dwell so users can read the detail.
        show(message, { tone: 'error', detail, durationMs: 3600 }),
      dismiss,
    }),
    [dismiss, show],
  );

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport payload={current} offset={offset} opacity={opacity} onPress={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  payload,
  offset,
  opacity,
  onPress,
}: {
  payload: ToastPayload | null;
  offset: SharedValue<number>;
  opacity: SharedValue<number>;
  onPress: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const { t } = useTranslation('common');

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
    opacity: opacity.value,
  }));

  if (!payload) return null;

  const { background, ink } = toneColors(payload.tone, colors, accent);

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + 8,
        left: 16,
        right: 16,
        alignItems: 'center',
      }}
    >
      <Animated.View
        style={[
          {
            maxWidth: 480,
            width: '100%',
            backgroundColor: background,
            borderRadius: 16,
            paddingHorizontal: 14,
            paddingVertical: 12,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 10 },
            elevation: 6,
          },
          animatedStyle,
        ]}
      >
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={t('toast.dismiss')}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}
        >
          <Icon name={TOAST_ICON[payload.tone]} size={18} color={ink} weight="fill" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodySemi" weight="700" style={{ color: ink, fontSize: 14 }}>
              {payload.message}
            </Text>
            {payload.detail ? (
              <Text variant="caption" style={{ color: ink, opacity: 0.85 }}>
                {payload.detail}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// Tone palette is sourced from the theme so dark mode and the
// active accent stay consistent. We deliberately don't use the
// `colors.success` / `colors.danger` raw values for background —
// they're tuned for inline use, not for a floating HUD.
function toneColors(
  tone: ToastTone,
  colors: ReturnType<typeof useTheme>['colors'],
  accent: ReturnType<typeof useTheme>['accent'],
) {
  switch (tone) {
    case 'success':
      return { background: colors.success, ink: '#FFFFFF' };
    case 'error':
      return { background: colors.danger, ink: '#FFFFFF' };
    case 'info':
    default:
      return { background: accent.solid, ink: accent.ink };
  }
}
