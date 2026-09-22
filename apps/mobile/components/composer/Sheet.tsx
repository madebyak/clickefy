/**
 * Sheet — the composer's base bottom sheet: dimmed backdrop, rounded
 * card, grabber, optional title, scrollable body. Every option pill
 * opens one of these, so they all share identical chrome and dismissal
 * behaviour (tap outside, hardware back on Android).
 *
 * Animation is hand-rolled on purpose: RN Modal's `animationType`
 * animates the WHOLE layer, so the dark backdrop visibly slid up with
 * the card — which read as broken. Here the Modal itself doesn't
 * animate at all; the backdrop FADES in place while only the card
 * slides, each with its own curve, and the exit plays fully before the
 * Modal unmounts.
 */

import { Pressable, Text, useTheme } from '@clickfy/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SLIDE_DISTANCE = 480;
const ENTER_MS = 260;
const EXIT_MS = 190;

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Fires once the exit animation finished AND the native Modal
   * unmounted. iOS silently drops any presentation (image picker,
   * camera) requested while a modal is still dismissing — actions that
   * present something must wait for this.
   */
  onDismissed?: () => void;
  title?: string;
  children: ReactNode;
  /** Max sheet height as a percentage of the screen. Default '70%'. */
  maxHeight?: `${number}%`;
}

export function Sheet({ visible, onClose, onDismissed, title, children, maxHeight = '70%' }: SheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // The Modal stays mounted through the exit animation; `mounted`
  // trails `visible` by EXIT_MS on the way out.
  const [mounted, setMounted] = useState(visible);
  const backdrop = useSharedValue(0);
  const translateY = useSharedValue(SLIDE_DISTANCE);
  const finishExit = () => {
    setMounted(false);
    // A beat for the native dismissal to settle before anything new
    // presents (picker/camera).
    if (onDismissed) setTimeout(onDismissed, 80);
  };

  // React's sanctioned "adjust state during render" pattern — mounting
  // must happen before the enter animation, and doing it here (not in
  // the effect) avoids a redundant intermediate commit.
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      backdrop.value = withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.quad) });
      translateY.value = withTiming(0, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) });
    } else {
      backdrop.value = withTiming(0, { duration: EXIT_MS, easing: Easing.in(Easing.quad) });
      translateY.value = withTiming(
        SLIDE_DISTANCE,
        { duration: EXIT_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(finishExit)();
        },
      );
    }
  }, [visible, backdrop, translateY]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Backdrop — fades in place, never moves. */}
        <Animated.View
          style={[
            { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
            backdropStyle,
          ]}
        >
          <Pressable onPress={onClose} style={{ flex: 1 }} accessibilityLabel="Dismiss" />
        </Animated.View>

        {/* Card — the only thing that slides. */}
        <Animated.View
          style={[
            {
              backgroundColor: colors.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingTop: 10,
              paddingBottom: insets.bottom + 16,
              maxHeight,
            },
            cardStyle,
          ]}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.borderStrong,
              marginBottom: 12,
            }}
          />
          {title ? (
            <Text
              variant="subhead"
              color="ink"
              weight="700"
              style={{ paddingHorizontal: 24, marginBottom: 8 }}
            >
              {title}
            </Text>
          ) : null}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4 }}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
