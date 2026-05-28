/**
 * Home banner strip — rendered above the "Trending Now" rail.
 *
 * One row from `GET /v1/catalog/banners`. Renders one of three layouts
 * driven by the discriminated `kind` on the DTO:
 *
 *   - `image`         → single static image
 *   - `image_slider`  → multi-image horizontal pager, dot indicator
 *                       below, **manual swipe only** (no auto-advance —
 *                       admin sorts so the lead image is always #1)
 *   - `video`         → muted, looping, auto-playing clip via the
 *                       existing `<VideoPreview />` primitive
 *
 * Layout:
 *   - 16:9 aspect, full-width inside the home `px="lg"` rhythm.
 *   - Optional title/subtitle overlay on the bottom-left, drawn over a
 *     subtle linear gradient so light banners don't drown the text.
 *
 * Tap behaviour: dispatched on the `cta` envelope.
 *   - `none`         → no-op (decorative banner; no pressed state)
 *   - `template`     → router push to `/template/<id>`
 *   - `category`     → router push to home with that category active
 *                      (deep-link not yet wired; falls back to no-op)
 *   - `external_url` → `Linking.openURL(target)` so the system browser
 *                      handles it. Keeps users out of an in-app webview
 *                      where session storage / cookies wouldn't survive
 *                      a sign-in roundtrip.
 *
 * Why the renderer is colocated (not split per kind):
 *   - All three share the overlay, gradient, padding, aspect math and
 *     CTA logic. Splitting would 3x the boilerplate.
 *   - The local component count stays low; tap-target wrapping happens
 *     in one place; Layout shifts are impossible.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, Text, useTheme } from '@clickfy/ui';
import type { MobileHomeBanner } from '@clickfy/sdk';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';

import { VideoPreview } from './VideoPreview';

interface SliderImage {
  url: string;
  blurhash: string;
}

/**
 * Side gutter — must match the `px="lg"` token used elsewhere on
 * the home screen so the banner aligns with the rails below it.
 * `lg` resolves to 20 in the theme.
 */
const SIDE_GUTTER = 20;
const ASPECT = 16 / 9;
const RADIUS = 22;

export interface HomeBannerProps {
  banner: MobileHomeBanner;
}

export function HomeBanner({ banner }: HomeBannerProps) {
  const router = useRouter();

  const onCtaTap = () => {
    const { kind, target } = banner.cta;
    if (kind === 'none' || !target) return;
    if (kind === 'template') {
      router.push(`/template/${target}`);
      return;
    }
    if (kind === 'external_url') {
      void Linking.openURL(target).catch(() => {
        // Swallow URL-open failures — the banner is best-effort
        // navigation and we don't want to crash the home tab.
      });
      return;
    }
    // 'category' deep-link not wired yet; treated as no-op so taps
    // don't visually fail. Wire when the home accepts a category
    // route param (planned alongside the home overhaul).
  };

  const tappable = banner.cta.kind !== 'none' && Boolean(banner.cta.target);

  const inner = (
    <View style={styles.frame}>
      {banner.kind === 'video' ? (
        <VideoPreview
          source={banner.video.hlsUrl}
          posterUri={banner.video.posterUrl}
          contentFit="cover"
          style={StyleSheet.absoluteFill as ViewStyle}
        />
      ) : banner.kind === 'image_slider' ? (
        <SliderBody images={banner.images} />
      ) : (
        <Image
          source={{ uri: banner.image.url }}
          placeholder={{ blurhash: banner.image.blurhash }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
        />
      )}

      {/* Text overlay only renders when the admin gave us copy.
          The gradient under it is conditional too — clean banners
          shouldn't get a tint they don't need. */}
      {(banner.title || banner.subtitle) ? (
        <>
          <LinearGradient
            // Bottom-shaded gradient — black 0% → 65% over the lower
            // half. Same darken pattern as TemplateCard's title rail.
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)']}
            locations={[0.45, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.overlay} pointerEvents="none">
            {banner.title ? (
              <Text variant="heading" color="white" numberOfLines={2}>
                {banner.title}
              </Text>
            ) : null}
            {banner.subtitle ? (
              <Text
                variant="caption"
                color="white"
                numberOfLines={2}
                style={{ opacity: 0.92, marginTop: 2 }}
              >
                {banner.subtitle}
              </Text>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );

  return (
    <View style={{ paddingHorizontal: SIDE_GUTTER }}>
      {tappable ? (
        <Pressable onPress={onCtaTap} haptic="light" pressedOpacity={0.94}>
          {inner}
        </Pressable>
      ) : (
        inner
      )}
    </View>
  );
}

// ─── Slider body ────────────────────────────────────────────────────

function SliderBody({ images }: { images: SliderImage[] }) {
  const { colors } = useTheme();
  const [pageIdx, setPageIdx] = useState(0);
  const [width, setWidth] = useState(0);

  // Each page is exactly the slider's measured width — guarantees
  // crisp paging regardless of device width or font-scaling-driven
  // layout shifts. We snap on the visible width via `pagingEnabled`.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== pageIdx) setPageIdx(next);
  };

  return (
    <>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={StyleSheet.absoluteFill}
      >
        {images.map((img, i) => (
          <View key={`${img.url}-${i}`} style={{ width, height: '100%' }}>
            <Image
              source={{ uri: img.url }}
              placeholder={{ blurhash: img.blurhash }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              transition={180}
            />
          </View>
        ))}
      </ScrollView>

      {images.length > 1 ? (
        <View style={styles.dotsRow} pointerEvents="none">
          {images.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === pageIdx ? '#FFFFFF' : 'rgba(255,255,255,0.45)',
                  // Fallback border so dots stay legible on very-bright
                  // banner imagery (e.g. white-on-white photoshoots).
                  borderColor: colors.bg,
                },
              ]}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: ASPECT,
    width: '100%',
    borderRadius: RADIUS,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  overlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
  },
  dotsRow: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
