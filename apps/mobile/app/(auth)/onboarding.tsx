/**
 * Onboarding — 3-slide first-run experience.
 *
 * Layout per slide:
 *   - Top: back chevron · 3-segment progress bar · Skip
 *   - Middle: FloatingDeck composition (orbit / grid / stack)
 *   - Bottom: eyebrow + serif-italic headline + body + Continue button
 *   - Footer (last slide only): "Already have an account? Sign in"
 *
 * Motion:
 *   - Headline does a 14pt slide-up + fade on each slide change.
 *   - Cards do continuous Ken-Burns drift and are re-keyed on slide change
 *     so they cross-fade between layouts.
 *   - Each slide transition fires a `selection` haptic.
 *
 * Design references in `docs/design-refs/onboarding/` — composition borrows
 * from Pi (tilted cards over warm canvas) and Clubhouse (segmented progress
 * + Continue → CTA + Sign-in footer).
 */

import { Button, Pressable, useTheme } from '@clickfy/ui';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingDeck, type FloatingDeckProps } from '@/components/onboarding/FloatingDeck';
import {
  slide1Images,
  slide2Images,
  slide3Images,
} from '@/components/onboarding/images';
import { ProgressBar } from '@/components/onboarding/ProgressBar';
import { SlideHeading } from '@/components/onboarding/SlideHeading';
import { Icon } from '@/components/ui/Icon';
import { tap } from '@/lib/haptics';
import { useAuthGate } from '@/lib/auth-gate';

// ─── Slide content ───────────────────────────────────────────────────

interface Slide {
  deck: FloatingDeckProps;
  eyebrow: string;
  headPre: string;
  headEm: string;
  headPost: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    deck: { layout: 'orbit', sources: slide1Images },
    eyebrow: 'Meet Clickefy',
    headPre: 'Studio-grade hero shots in ',
    headEm: 'one tap',
    headPost: '.',
    body:
      "Drop your product photo and we'll handle the lighting, shadows, and polish — automatically.",
  },
  {
    deck: { layout: 'grid', sources: slide2Images },
    eyebrow: 'Browse the catalog',
    headPre: '',
    headEm: 'Hundreds ',
    headPost: 'of templates, zero design skills.',
    body:
      'Pick a vibe — skincare, food, fashion, tech. Every template is tuned by a creative director so you don\u2019t have to think.',
  },
  {
    deck: { layout: 'stack', sources: slide3Images, showPlayBadge: true },
    eyebrow: 'Go beyond photos',
    headPre: 'Turn any photo into a ',
    headEm: 'scroll-stopping',
    headPost: ' video.',
    body:
      "4\u20138 second product clips, perfect for Reels, TikTok, and your storefront.",
  },
];

// ─── Screen ──────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { markOnboardingComplete } = useAuthGate();

  const [index, setIndex] = useState(0);
  const slide = SLIDES[index]!;
  const isLast = index === SLIDES.length - 1;
  const isFirst = index === 0;

  const finish = async () => {
    tap('success');
    await markOnboardingComplete();
    router.replace('/(auth)/welcome');
  };

  const handleNext = () => {
    if (isLast) {
      void finish();
      return;
    }
    tap('selection');
    setIndex((i) => Math.min(SLIDES.length - 1, i + 1));
  };

  const handleBack = () => {
    if (isFirst) return;
    tap('selection');
    setIndex((i) => Math.max(0, i - 1));
  };

  const handleSkip = () => {
    void finish();
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* ─── Top: back · progress · skip ─── */}
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top + 8 },
        ]}
      >
        <TopCorner
          accessibilityLabel="Back"
          onPress={isFirst ? undefined : handleBack}
          disabled={isFirst}
          icon={
            <Icon name="chevronLeft" size={20} color={colors.ink} weight="bold" />
          }
        />

        <ProgressBar current={index} total={SLIDES.length} />

        <TopCorner
          accessibilityLabel="Skip onboarding"
          onPress={handleSkip}
          icon={
            <Animated.Text style={[styles.skipText, { color: colors.inkMuted }]}>
              Skip
            </Animated.Text>
          }
        />
      </View>

      {/* ─── Deck (animated key on slide change) ─── */}
      <View style={styles.deckWrap}>
        <SlideCrossfade slideKey={index}>
          <FloatingDeck {...slide.deck} />
        </SlideCrossfade>
      </View>

      {/* ─── Bottom content ─── */}
      <View
        style={[
          styles.bottom,
          { paddingBottom: insets.bottom + 20 },
        ]}
      >
        <SlideHeading
          slideKey={index}
          eyebrow={slide.eyebrow}
          headPre={slide.headPre}
          headEm={slide.headEm}
          headPost={slide.headPost}
          body={slide.body}
        />

        <View style={styles.cta}>
          <Button
            variant="accent"
            size="lg"
            full
            haptic="medium"
            onPress={handleNext}
            trailing={
              <Icon
                name="arrowRight"
                size={18}
                color={colors.surface}
                weight="bold"
              />
            }
          >
            {isLast ? 'Get started' : 'Continue'}
          </Button>

        </View>
      </View>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function TopCorner({
  onPress,
  icon,
  disabled,
  accessibilityLabel,
}: {
  onPress?: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress ?? (() => {})}
      disabled={disabled}
      haptic="light"
      pressedOpacity={0.7}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={{
        width: 56,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0 : 1,
      }}
    >
      {icon}
    </Pressable>
  );
}

/** Crossfade slot — children re-mount when `slideKey` changes, with a quick fade. */
function SlideCrossfade({
  children,
  slideKey,
}: {
  children: React.ReactNode;
  slideKey: number;
}) {
  // Initial value = 0 so the freshly-mounted children fade in cleanly.
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
  }, [slideKey, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View key={slideKey} style={[styles.crossfade, animStyle]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  skipText: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 14,
  },
  deckWrap: {
    flex: 1,
    minHeight: 320,
  },
  crossfade: {
    flex: 1,
  },
  bottom: {
    paddingHorizontal: 24,
    paddingTop: 24,
    gap: 20,
  },
  cta: {
    gap: 12,
    alignItems: 'center',
  },
});
