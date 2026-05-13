/**
 * HeroMedia — adaptive hero for the template detail page.
 *
 * Follows the reference prototype exactly:
 *   - Full-bleed cover with a vertical gradient scrim
 *   - Adapts height to the template's aspect ratio
 *   - Gallery carousel with dot indicators when applicable
 *   - Video auto-play when applicable
 */

import type { CatalogTemplate } from '@clickfy/sdk';
import { useTheme } from '@clickfy/ui';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { VideoPreview } from '@/components/home/VideoPreview';
import { resolveLocalVideo } from '@/lib/local-videos';

export interface HeroMediaProps {
  template: CatalogTemplate;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function parseAspect(aspect: string): number {
  const parts = aspect.split('/');
  const w = Number(parts[0]) || 4;
  const h = Number(parts[1]) || 5;
  return w / h;
}

export function getHeroHeight(aspect: string): number {
  const ratio = parseAspect(aspect);
  if (ratio >= 1.4) return SCREEN_WIDTH * 0.65;
  if (ratio >= 0.9) return SCREEN_WIDTH * 0.95;
  return SCREEN_WIDTH * 1.15;
}

const GRADIENT_COLORS = [
  'rgba(0,0,0,0.25)',
  'rgba(0,0,0,0)',
  'rgba(0,0,0,0)',
  'rgba(0,0,0,0.55)',
] as const;
const GRADIENT_LOCATIONS = [0, 0.3, 0.6, 1] as const;

export function HeroMedia({ template }: HeroMediaProps) {
  const { colors } = useTheme();

  const videoSource = useMemo(
    () => resolveLocalVideo(template.previewVideo),
    [template.previewVideo],
  );
  const galleryImages = useMemo(
    () => (template.gallery ?? []).filter(Boolean),
    [template.gallery],
  );
  const hasCarousel = galleryImages.length > 1;
  const heroHeight = getHeroHeight(template.aspect);

  const [activeIndex, setActiveIndex] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (next !== activeIndex) setActiveIndex(next);
  };

  if (hasCarousel) {
    return (
      <View style={{ width: SCREEN_WIDTH, height: heroHeight, backgroundColor: colors.surfaceMuted }}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {galleryImages.map((uri, i) => (
            <Image
              key={`${uri}-${i}`}
              source={uri}
              style={{ width: SCREEN_WIDTH, height: heroHeight }}
              contentFit="cover"
              transition={120}
            />
          ))}
        </ScrollView>
        <LinearGradient
          colors={GRADIENT_COLORS}
          locations={GRADIENT_LOCATIONS}
          style={{ position: 'absolute', inset: 0 }}
          pointerEvents="none"
        />
        {/* Dot indicators */}
        <View
          style={{
            position: 'absolute',
            bottom: 44,
            left: 0,
            right: 0,
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {galleryImages.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === activeIndex ? 18 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor:
                  i === activeIndex ? '#FFFFFF' : 'rgba(255,255,255,0.55)',
              }}
            />
          ))}
        </View>
      </View>
    );
  }

  if (videoSource) {
    return (
      <View style={{ width: SCREEN_WIDTH, height: heroHeight, backgroundColor: colors.surfaceMuted }}>
        <VideoPreview
          source={videoSource}
          posterUri={template.coverImage}
          contentFit="cover"
          style={{ flex: 1 }}
        />
        <LinearGradient
          colors={GRADIENT_COLORS}
          locations={GRADIENT_LOCATIONS}
          style={{ position: 'absolute', inset: 0 }}
          pointerEvents="none"
        />
      </View>
    );
  }

  return (
    <View style={{ width: SCREEN_WIDTH, height: heroHeight, backgroundColor: colors.surfaceMuted }}>
      <Image
        source={template.coverImage}
        contentFit="cover"
        style={{ width: '100%', height: '100%' }}
        transition={200}
      />
      <LinearGradient
        colors={GRADIENT_COLORS}
        locations={GRADIENT_LOCATIONS}
        style={{ position: 'absolute', inset: 0 }}
        pointerEvents="none"
      />
    </View>
  );
}
