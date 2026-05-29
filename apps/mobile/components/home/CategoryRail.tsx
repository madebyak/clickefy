import type { CatalogCategory } from '@clickfy/sdk';
import { Pressable, Text, useTheme } from '@clickfy/ui';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';

export interface CategoryRailProps {
  categories: CatalogCategory[];
  activeId: string;
  onSelect: (id: string) => void;
}

// ─── Sizing ─────────────────────────────────────────────────────────
// The chip is a vertical card: padded surface that holds the
// square category artwork on top and the label underneath. Sizes
// are tuned so 4–4.5 cards are visible on a 390pt iPhone.

const CARD_WIDTH = 80;
const CARD_RADIUS = 18;
const CARD_PAD_TOP = 8;
const CARD_PAD_X = 8;
const CARD_PAD_BOTTOM = 10;
const IMAGE_SIZE = CARD_WIDTH - CARD_PAD_X * 2; // 64
const IMAGE_RADIUS = 14;
const IMAGE_LABEL_GAP = 6;

/** Synthetic "All" pseudo-category — never returned by the API. */
const ALL_CHIP: CatalogCategory = {
  id: 'all',
  label: 'All',
  imageUri: null,
  color: 'transparent',
};

/**
 * Horizontal rail of vertical chip cards. Each chip is a small
 * surface (slightly darker on light theme, slightly lighter on
 * dark theme) holding the category artwork and label.
 *
 * Selection state flips the whole card surface to `accent.solid`
 * and the label to `accent.ink` (auto-contrast per accent palette
 * — white on Violet/Coral/Ocean, dark on Citrus). The image itself
 * keeps its native colors at all times so the artwork stays
 * recognisable across both states.
 *
 * Resilience:
 *   - Always pre-pends an "All" chip so the rail isn't empty during
 *     the initial fetch / on API failure.
 *   - Falls back to a coloured letter tile when `imageUri` is null
 *     or the image fails to load.
 *   - Filtered to root categories upstream; this component does
 *     not need to know about sub-categories.
 */
export function CategoryRail({ categories, activeId, onSelect }: CategoryRailProps) {
  const { colors, accent } = useTheme();

  // Root-only filter (defensive — caller already filters, but a
  // double-check keeps stray children out if upstream regresses).
  const items = useMemo(
    () => [ALL_CHIP, ...categories.filter((c) => !c.parentId)],
    [categories],
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
    >
      {items.map((cat) => {
        const isActive = cat.id === activeId;
        const isAllChip = cat.id === 'all';
        const initial = cat.label?.[0]?.toUpperCase() ?? '?';

        // Card surface flips to accent.solid when active; label
        // flips to accent.ink so contrast holds across every
        // accent palette (white for Violet/Coral/Ocean, dark for
        // Citrus). Inactive label stays on the standard ink token.
        const cardBg = isActive ? accent.solid : colors.chipSurface;
        const labelColor = isActive ? accent.ink : colors.ink;

        return (
          <Pressable
            key={cat.id}
            onPress={() => onSelect(cat.id)}
            haptic="selection"
            pressedOpacity={0.85}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={{
              width: CARD_WIDTH,
              paddingTop: CARD_PAD_TOP,
              paddingHorizontal: CARD_PAD_X,
              paddingBottom: CARD_PAD_BOTTOM,
              borderRadius: CARD_RADIUS,
              backgroundColor: cardBg,
              alignItems: 'center',
            }}
          >
            <View
              style={{
                width: IMAGE_SIZE,
                height: IMAGE_SIZE,
                borderRadius: IMAGE_RADIUS,
                // Artwork keeps a stable interior surface so the
                // image edge reads cleanly against the card BG in
                // both states. For the "All" chip we use the ink
                // token directly so the categories icon sits on a
                // dark plate per the original design rhythm.
                backgroundColor: isAllChip ? colors.ink : cat.color,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isAllChip ? (
                <Icon
                  name="categories"
                  size={26}
                  color={colors.surface}
                  weight="fill"
                />
              ) : cat.imageUri ? (
                <Image
                  source={cat.imageUri}
                  contentFit="cover"
                  style={{ width: '100%', height: '100%' }}
                  transition={120}
                  recyclingKey={cat.id}
                />
              ) : (
                <Text
                  variant="title"
                  weight="700"
                  style={{ color: colors.surface, fontSize: 22, lineHeight: 24 }}
                >
                  {initial}
                </Text>
              )}
            </View>

            <Text
              variant="caption"
              weight={isActive ? '700' : '600'}
              numberOfLines={1}
              style={{
                marginTop: IMAGE_LABEL_GAP,
                fontSize: 12,
                letterSpacing: -0.1,
                color: labelColor,
                maxWidth: IMAGE_SIZE,
              }}
            >
              {cat.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
