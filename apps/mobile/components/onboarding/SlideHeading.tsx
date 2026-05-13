/**
 * SlideHeading — eyebrow + Instrument-Serif headline with an italic emphasis
 * word + supporting body copy. Animates in (slide up + fade) whenever its
 * `slideKey` prop changes, which the parent screen flips on each navigation.
 *
 * Centralising the headline layout means every slide looks identical in
 * rhythm/spacing/weight — only the copy changes.
 */

import { useTheme } from '@clickfy/ui';
import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export interface SlideHeadingProps {
  /** Small uppercase label above the headline */
  eyebrow: string;
  /** Headline pre-italic copy (regular weight) */
  headPre: string;
  /** Italic emphasis word(s) */
  headEm: string;
  /** Headline post-italic copy */
  headPost: string;
  /** Body sub-copy under the headline */
  body: string;
  /** Bump this when the active slide changes — triggers the entry animation */
  slideKey: number;
}

export function SlideHeading({
  eyebrow,
  headPre,
  headEm,
  headPost,
  body,
  slideKey,
}: SlideHeadingProps) {
  const { colors, accent } = useTheme();

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(14);

  useEffect(() => {
    opacity.value = 0;
    translateY.value = 14;
    opacity.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) });
  }, [slideKey, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.wrap, animStyle]}>
      <Text
        style={[
          styles.eyebrow,
          { color: accent.solid },
        ]}
      >
        {eyebrow}
      </Text>

      <Text style={[styles.headline, { color: colors.ink }]}>
        {headPre}
        <Text style={[styles.headlineItalic, { color: colors.ink }]}>
          {headEm}
        </Text>
        {headPost}
      </Text>

      <Text style={[styles.body, { color: colors.inkMuted }]}>
        {body}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
  eyebrow: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 11.5,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    lineHeight: 14,
  },
  headline: {
    fontFamily: 'Geist_700Bold',
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.9,
  },
  headlineItalic: {
    fontFamily: 'InstrumentSerif_400Regular_Italic',
    // Serif italic is taller — bump size slightly so it reads as the same word.
    fontSize: 38,
    lineHeight: 38,
    letterSpacing: -0.6,
  },
  body: {
    fontFamily: 'Geist_400Regular',
    fontSize: 15.5,
    lineHeight: 23,
    letterSpacing: -0.1,
    marginTop: 4,
  },
});
