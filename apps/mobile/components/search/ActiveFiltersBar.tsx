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
  /** "Clear all" — visible only when 2+ filters are active. */
  onClearAll?: () => void;
}

const KIND_LABEL: Record<TemplateKindFilter, string> = {
  image: 'Image',
  video: 'Video',
  image_set: 'Set',
};

const SORT_LABEL: Record<TemplateSortFilter, string> = {
  default: 'Recommended',
  recent: 'Newest',
};

export function ActiveFiltersBar({
  filters,
  onClearKind,
  onClearFeatured,
  onClearSort,
  onClearAll,
}: ActiveFiltersBarProps) {
  const active = countActiveFilters(filters);
  if (active === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingVertical: 4 }}
    >
      {filters.kind ? (
        <DismissibleChip
          label={KIND_LABEL[filters.kind]}
          onDismiss={onClearKind}
        />
      ) : null}
      {filters.featured ? (
        <DismissibleChip label="Featured" onDismiss={onClearFeatured} />
      ) : null}
      {filters.sort !== 'default' ? (
        <DismissibleChip
          label={SORT_LABEL[filters.sort]}
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
  return (
    <View
      style={{
        height: 30,
        paddingLeft: 12,
        paddingRight: 6,
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
        accessibilityLabel={`Remove ${label} filter`}
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
  return (
    <Pressable
      onPress={onPress}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel="Clear all filters"
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
        Clear all
      </Text>
    </Pressable>
  );
}
