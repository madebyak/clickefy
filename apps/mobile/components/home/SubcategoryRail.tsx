import type { CatalogCategory } from '@clickfy/sdk';
import { Pressable, Text, useTheme } from '@clickfy/ui';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';

export interface SubcategoryRailProps {
  /** The parent root whose children we're rendering. Used for the "All" pill label. */
  parent: CatalogCategory;
  /** Direct children of `parent` — drawn from `parent.children`. Can be empty. */
  subcategories: CatalogCategory[];
  /**
   * `null` means the synthetic "All" pill (templates from `parent`
   * AND any of its children, aggregated server-side). A child id
   * narrows the grid to that specific sub-category.
   */
  activeChildId: string | null;
  onSelect: (childId: string | null) => void;
}

const PILL_HEIGHT = 44;
const PILL_RADIUS = 22;
const THUMB_SIZE = 32;

/**
 * Horizontal rail of rectangular pill buttons (image on the left,
 * label on the right) — surfaces a root category's sub-categories
 * below the main square rail.
 *
 * Why a separate component from CategoryRail:
 *   - Different shape (rectangle vs square) and different content
 *     density. Sharing the chip primitive would mean a branch on
 *     every render with two layouts; cleaner to split.
 *   - Different selection semantics: the synthetic id here is
 *     `null` (= "all under this parent"), not the literal string
 *     `'all'` the main rail uses for "All categories".
 *
 * The "All" pill is always rendered first and uses the parent's
 * own iconUri so the visual anchor stays stable as the user
 * toggles between sub-categories.
 */
export function SubcategoryRail({
  parent,
  subcategories,
  activeChildId,
  onSelect,
}: SubcategoryRailProps) {
  const { colors, accent } = useTheme();
  const { t } = useTranslation('home');

  // Wrap subcategories in a stable, memoised list with the "All"
  // pill pinned to the front. We use `null` as the sentinel id so
  // the active-state comparison is a single `=== null` check (no
  // string collision with a real category id ever called "all").
  const items = useMemo(
    () => [
      { kind: 'all' as const },
      ...subcategories.map((c) => ({ kind: 'child' as const, cat: c })),
    ],
    [subcategories],
  );

  if (subcategories.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 10, alignItems: 'center' }}
    >
      {items.map((item) => {
        const isAll = item.kind === 'all';
        const cat = isAll ? null : item.cat;
        const id = isAll ? null : cat!.id;
        const isActive = activeChildId === id;
        const label = isAll ? t('subcategoryRail.all', { parent: parent.label }) : (cat!.label ?? '');
        const imageUri = isAll ? parent.imageUri : cat!.imageUri;

        return (
          <Pressable
            key={isAll ? '__all__' : cat!.id}
            onPress={() => onSelect(id)}
            haptic="selection"
            pressedOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              height: PILL_HEIGHT,
              paddingStart: 6,
              paddingEnd: 14,
              borderRadius: PILL_RADIUS,
              backgroundColor: isActive ? accent.solid : colors.surface,
              borderWidth: 1,
              borderColor: isActive ? accent.solid : colors.border,
            }}
          >
            <View
              style={{
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                borderRadius: THUMB_SIZE / 2,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isActive ? colors.surface : colors.surfaceMuted,
              }}
            >
              {imageUri ? (
                <Image
                  source={imageUri}
                  contentFit="cover"
                  style={{ width: '100%', height: '100%' }}
                  transition={120}
                  recyclingKey={isAll ? `all-${parent.id}` : cat!.id}
                />
              ) : (
                <Icon
                  name={isAll ? 'categories' : 'sparkle'}
                  size={16}
                  color={isActive ? accent.solid : colors.inkMuted}
                  weight="fill"
                />
              )}
            </View>
            <Text
              variant="caption"
              weight="600"
              numberOfLines={1}
              style={{
                fontSize: 13,
                letterSpacing: -0.1,
                color: isActive ? colors.surface : colors.ink,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
