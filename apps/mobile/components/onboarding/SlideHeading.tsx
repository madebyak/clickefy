/**
 * SlideHeading — eyebrow + upright Instrument-Serif headline with an
 * accent-colored emphasis word + supporting body copy. Animates in (slide up
 * + fade) whenever its `slideKey` prop changes, which the parent screen flips
 * on each navigation.
 *
 * Matches the welcome screen's tagline voice (upright serif, natural
 * tracking, sentence case) — emphasis is carried by the brand accent color,
 * not italics.
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
  /** Headline copy before the emphasis */
  headPre: string;
  /** Accent-colored emphasis word(s) */
  headEm: string;
  /** Headline copy after the emphasis */
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
        <Text style={[styles.headlineEm, { color: accent.solid }]}>
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
  // Same face and tracking rules as the welcome tagline, sized up for the
  // slide's display moment.
  headline: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: 0,
  },
  headlineEm: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: 0,
  },
  body: {
    fontFamily: 'Geist_400Regular',
    fontSize: 15.5,
    lineHeight: 23,
    letterSpacing: -0.1,
    marginTop: 4,
  },
});
