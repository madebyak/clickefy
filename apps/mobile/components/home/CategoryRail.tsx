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

const CHIP_SIZE = 64;
/** Match TemplateCard radius (18) so the visual language is consistent. */
const CHIP_RADIUS = 18;

/** Synthetic "All" pseudo-category — never returned by the API. */
const ALL_CHIP: CatalogCategory = {
  id: 'all',
  label: 'All',
  imageUri: null,
  color: 'transparent',
};

/**
 * Horizontal rail of rounded-square category chips. Same border-radius
 * as template cards = consistent visual rhythm.
 *
 * Resilience notes:
 *   - Always prepends an "All" chip so the rail isn't empty during the
 *     initial fetch / on API failure (caller can still pass an empty
 *     `categories` array and get a usable rail).
 *   - Falls back to a coloured letter tile when `imageUri` is null or
 *     the image fails to load (e.g. CDN hiccup).
 */
export function CategoryRail({ categories, activeId, onSelect }: CategoryRailProps) {
  const { colors, accent } = useTheme();

  const items = useMemo(() => [ALL_CHIP, ...categories], [categories]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
    >
      {items.map((cat) => {
        const isActive = cat.id === activeId;
        const isAllChip = cat.id === 'all';
        const initial = cat.label?.[0]?.toUpperCase() ?? '?';
        return (
          <Pressable
            key={cat.id}
            onPress={() => onSelect(cat.id)}
            haptic="selection"
            pressedOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={{ alignItems: 'center', gap: 8, width: CHIP_SIZE }}
          >
            <View
              style={{
                width: CHIP_SIZE,
                height: CHIP_SIZE,
                borderRadius: CHIP_RADIUS,
                backgroundColor: isAllChip ? colors.ink : cat.color,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: isActive ? 2 : 1,
                borderColor: isActive ? accent.solid : colors.border,
              }}
            >
              {isAllChip ? (
                <Icon name="categories" size={26} color={colors.surface} weight="fill" />
              ) : cat.imageUri ? (
                <Image
                  source={cat.imageUri}
                  contentFit="cover"
                  style={{ width: '100%', height: '100%' }}
                  transition={120}
                  // Falls back to the coloured tile below when load fails.
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
              color={isActive ? 'ink' : 'inkMuted'}
              weight={isActive ? '600' : '500'}
              numberOfLines={1}
              style={{ fontSize: 12.5, letterSpacing: -0.1 }}
            >
              {cat.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
