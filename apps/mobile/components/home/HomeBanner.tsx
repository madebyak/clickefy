/**
 * Home banner strip — one 16:9 slot rendered above the "Trending Now"
 * rail. If the admin curates multiple active banner rows, the slot
 * becomes a horizontal pager (manual swipe, pagination dots). The slot
 * itself never stacks: there is always exactly one banner visible.
 *
 * Per-slide kinds:
 *   - `image` → single static image, blurhash placeholder
 *   - `video` → muted, looping, auto-playing clip via `<VideoPreview />`
 *
 * (`image_slider` is preserved as a defensive fallback for any
 * legacy rows; new banners can no longer pick that kind.)
 *
 * CTA dispatch (per slide):
 *   - 'none'         → decorative; no pressed state
 *   - 'template'     → router push to /template/<id>
 *   - 'category'     → no-op until home accepts a category route param
 *   - 'external_url' → `Linking.openURL(target)` (system browser)
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, Text, useTheme } from '@clickfy/ui';
import type { MobileHomeBanner } from '@clickfy/sdk';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Dimensions,
  Linking,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';

import { thumbnailUrl } from '@/lib/image-url';
import { VideoPreview } from './VideoPreview';

/**
 * Side gutter — must match the `px="lg"` token used elsewhere on
 * the home screen so the banner aligns with the rails below it.
 * `lg` resolves to 20 in the theme.
 */
const SIDE_GUTTER = 20;
const ASPECT = 16 / 9;
const RADIUS = 22;
/** Banner fills the row minus both side gutters — size thumbnails to it. */
const BANNER_WIDTH = Math.round(Dimensions.get('window').width - SIDE_GUTTER * 2);

// ─── Public: HomeBannerSlider ──────────────────────────────────────
//
// The home screen mounts exactly one of these. It owns the 16:9
// frame and the page indicator. Each slide is a `<BannerSlide />`.

export interface HomeBannerSliderProps {
  banners: MobileHomeBanner[];
}

export function HomeBannerSlider({ banners }: HomeBannerSliderProps) {
  const { colors } = useTheme();
  const [pageIdx, setPageIdx] = useState(0);
  const [width, setWidth] = useState(0);

  if (banners.length === 0) return null;

  // Single banner — no pager overhead, just render the slide directly
  // inside the same gutter the slider would have used.
  if (banners.length === 1) {
    return (
      <View style={{ paddingHorizontal: SIDE_GUTTER }}>
        <View style={styles.frame}>
          <BannerSlide banner={banners[0]!} />
        </View>
      </View>
    );
  }

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== pageIdx) setPageIdx(next);
  };

  return (
    <View style={{ paddingHorizontal: SIDE_GUTTER }}>
      <View
        style={styles.frame}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={StyleSheet.absoluteFill}
        >
          {banners.map((banner) => (
            <View key={banner.id} style={{ width, height: '100%' }}>
              <BannerSlide banner={banner} />
            </View>
          ))}
        </ScrollView>

        <View style={styles.dotsRow} pointerEvents="none">
          {banners.map((b, i) => (
            <View
              key={b.id}
              style={[
                styles.dot,
                {
                  backgroundColor: i === pageIdx ? '#FFFFFF' : 'rgba(255,255,255,0.45)',
                  // Subtle border so dots stay legible on very-bright
                  // banner imagery (e.g. white-on-white photoshoots).
                  borderColor: colors.bg,
                },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Internal: BannerSlide ─────────────────────────────────────────
//
// Single banner content — image or video, with optional copy overlay
// and tap-through CTA. Designed to fill its parent (the 16:9 frame).

interface BannerSlideProps {
  banner: MobileHomeBanner;
}

function BannerSlide({ banner }: BannerSlideProps) {
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
        // Swallow URL-open failures — banner taps are best-effort
        // navigation and we don't want to crash the home tab.
      });
      return;
    }
    if (kind === 'category') {
      // Push back to the home tab with a categoryId param. The
      // tabs/index screen reads the param, finds the matching
      // root/child, and seeds activeCat + activeSubcategoryId
      // before clearing the param to avoid re-seeding on every
      // remount.
      router.push({ pathname: '/', params: { categoryId: target } });
      return;
    }
  };

  const tappable = banner.cta.kind !== 'none' && Boolean(banner.cta.target);

  const inner = (
    <View style={StyleSheet.absoluteFill as ViewStyle}>
      {banner.kind === 'video' ? (
        <VideoPreview
          source={banner.video.hlsUrl}
          posterUri={thumbnailUrl(banner.video.posterUrl, { width: BANNER_WIDTH })}
          contentFit="cover"
          style={StyleSheet.absoluteFill as ViewStyle}
        />
      ) : banner.kind === 'image_slider' ? (
        // Legacy fallback — new banners can't pick this kind, but if
        // the API ever returns one we still render the lead frame
        // gracefully instead of an empty slot.
        <Image
          source={{ uri: thumbnailUrl(banner.images[0]?.url, { width: BANNER_WIDTH }) }}
          placeholder={{ blurhash: banner.images[0]?.blurhash }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
        />
      ) : (
        <Image
          source={{ uri: thumbnailUrl(banner.image.url, { width: BANNER_WIDTH }) }}
          placeholder={{ blurhash: banner.image.blurhash }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
        />
      )}

      {(banner.title || banner.subtitle) ? (
        <>
          <LinearGradient
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

  if (!tappable) return inner;

  return (
    <Pressable
      onPress={onCtaTap}
      haptic="light"
      pressedOpacity={0.94}
      style={StyleSheet.absoluteFill as ViewStyle}
    >
      {inner}
    </Pressable>
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
