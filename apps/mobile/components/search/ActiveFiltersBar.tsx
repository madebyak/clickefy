/**
 * Horizontal strip of chips showing which filters are currently
 * applied on the search screen. Each chip is dismissible — tapping it
 * clears that single filter, leaving the rest in place. Mirrors the
 * pattern used by Apple Maps, Pinterest and the App Store.
 *
 * Renders nothing when no user filters are active so the search
 * screen stays calm in its empty state.
 */

import { Pressable, Text, useTheme } from '@clickfy/ui';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import {
  type SearchFilters,
  type TemplateKindFilter,
  type TemplateSortFilter,
  countActiveFilters,
} from '@/lib/search-state';

export interface ActiveFiltersBarProps {
  filters: SearchFilters;
  onClearKind?: () => void;
  onClearFeatured?: () => void;
  onClearSort?: () => void;
  /**
   * Clears the category scope back to a global search. Rendered as a
   * leading "In <label> ✕" chip — the visual cue that the current
   * results are narrowed to a single category, mirroring Etsy's
   * "Searching in <category>" pattern.
   */
  onClearCategory?: () => void;
  /** "Clear all" — visible only when 2+ filters are active. */
  onClearAll?: () => void;
}

export function ActiveFiltersBar({
  filters,
  onClearKind,
  onClearFeatured,
  onClearSort,
  onClearCategory,
  onClearAll,
}: ActiveFiltersBarProps) {
  const { t } = useTranslation('search');
  const active = countActiveFilters(filters);
  if (active === 0) return null;

  const kindLabel: Record<TemplateKindFilter, string> = {
    image: t('kind.image'),
    video: t('kind.video'),
    image_set: t('kind.set'),
    video_image: t('kind.video_image'),
  };
  const sortLabel: Record<TemplateSortFilter, string> = {
    default: t('activeFilters.sort.default'),
    recent: t('activeFilters.sort.recent'),
    popular: t('activeFilters.sort.popular'),
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingVertical: 4 }}
    >
      {/* Category scope leads — it's the strongest narrowing of the
          result set and the user's "where am I" anchor. */}
      {filters.categoryId && filters.categoryLabel ? (
        <DismissibleChip
          label={t('activeFilters.inCategory', { category: filters.categoryLabel })}
          onDismiss={onClearCategory}
        />
      ) : null}
      {filters.kind ? (
        <DismissibleChip
          label={kindLabel[filters.kind]}
          onDismiss={onClearKind}
        />
      ) : null}
      {filters.featured ? (
        <DismissibleChip label={t('activeFilters.featured')} onDismiss={onClearFeatured} />
      ) : null}
      {filters.sort !== 'default' ? (
        <DismissibleChip
          label={sortLabel[filters.sort]}
          onDismiss={onClearSort}
        />
      ) : null}
      {active > 1 ? (
        <ClearAllChip onPress={onClearAll} />
      ) : null}
    </ScrollView>
  );
}

function DismissibleChip({
  label,
  onDismiss,
}: {
  label: string;
  onDismiss?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('search');
  return (
    <View
      style={{
        height: 30,
        paddingStart: 12,
        paddingEnd: 6,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: colors.ink,
        backgroundColor: colors.ink,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        variant="caption"
        weight="600"
        style={{ fontSize: 12.5, lineHeight: 15, color: colors.surface }}
      >
        {label}
      </Text>
      <Pressable
        onPress={onDismiss}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel={t('activeFilters.removeAccessibilityLabel', { label })}
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="close" size={11} color={colors.surface} weight="bold" />
      </Pressable>
    </View>
  );
}

function ClearAllChip({ onPress }: { onPress?: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation('search');
  return (
    <Pressable
      onPress={onPress}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={t('activeFilters.clearAllAccessibilityLabel')}
      style={{
        height: 30,
        paddingHorizontal: 12,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
      }}
    >
      <Text
        variant="caption"
        weight="600"
        color="inkMuted"
        style={{ fontSize: 12.5, lineHeight: 15 }}
      >
        {t('activeFilters.clearAll')}
      </Text>
    </Pressable>
  );
}
