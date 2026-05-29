/**
 * Home `SearchBar` — non-editable entry point that navigates to the
 * full search experience.
 *
 * The bar is rendered as a single visual unit with **two independent
 * tap targets**:
 *
 *   • The input area (left side) — opens `/search` for typing.
 *   • The trailing sliders icon — opens the filter sheet directly.
 *
 * The icon is only rendered on surfaces where filters make sense
 * (`/search`, the home tab's category-grid view). On the editorially
 * curated home rails ("All" feed) we hide it entirely — there's
 * nothing to filter, so showing the affordance is misleading. Same
 * decision Pinterest, App Store and TikTok all make on their feed.
 */

import { Box, Pressable, Text, useTheme } from '@clickfy/ui';
import { View } from 'react-native';

import { Icon } from '@/components/ui/Icon';

export interface SearchBarProps {
  value?: string;
  placeholder?: string;
  /**
   * When set, the bar advertises a *scoped* search. We swap the
   * placeholder to `Search in ${scopeLabel}` and the consuming page is
   * expected to pre-seed the matching category filter on the search
   * route. Mirrors the Etsy / App Store pattern: search defaults to the
   * surface you're already in, with a clear escape hatch ("✕") on the
   * chip inside `/search`.
   */
  scopeLabel?: string;
  /** Called when the user taps the input area (or the bar with no filter affordance). */
  onPress?: () => void;
  /**
   * When provided, the trailing sliders icon becomes its own tap
   * target wired to this handler. Pass `undefined` to hide the icon
   * entirely — the right way to express "this surface has nothing to
   * filter" (home rails, section pages).
   */
  onPressFilters?: () => void;
  /**
   * Number of active filters. When > 0 we render a small dot on the
   * sliders icon — the standard mobile cue for "there's state behind
   * this control" (Apple Maps, App Store, Material 3 filter chip).
   */
  activeFilterCount?: number;
}

export function SearchBar({
  value,
  placeholder,
  scopeLabel,
  onPress,
  onPressFilters,
  activeFilterCount = 0,
}: SearchBarProps) {
  const resolvedPlaceholder =
    placeholder ?? (scopeLabel ? `Search in ${scopeLabel}` : 'Search templates');
  const { colors, accent } = useTheme();
  const showFilters = !!onPressFilters;

  return (
    <View
      style={{
        height: 52,
        paddingLeft: 16,
        paddingRight: showFilters ? 6 : 16,
        borderRadius: 18,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      {/* Input target — magnifier + label expand to fill the bar. */}
      <Pressable
        onPress={onPress}
        haptic="light"
        pressedOpacity={0.8}
        accessibilityRole="search"
        accessibilityLabel={resolvedPlaceholder}
        style={{
          flex: 1,
          height: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Icon name="search" size={20} color={colors.inkMuted} />
        <Text
          variant="body"
          color={value ? 'ink' : 'inkMuted'}
          style={{ flex: 1 }}
          numberOfLines={1}
        >
          {value || resolvedPlaceholder}
        </Text>
      </Pressable>

      {showFilters ? (
        <Pressable
          onPress={onPressFilters}
          haptic="light"
          pressedOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={
            activeFilterCount > 0
              ? `Filters, ${activeFilterCount} active`
              : 'Filters'
          }
          accessibilityState={{ selected: activeFilterCount > 0 }}
          style={{
            width: 40,
            height: 40,
            marginRight: 4,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            // Subtle "active" pill when filters are set so the user
            // can tell at a glance that the result set is narrowed.
            backgroundColor:
              activeFilterCount > 0 ? accent.soft : colors.surfaceMuted,
          }}
        >
          <Icon
            name="sliders"
            size={16}
            color={activeFilterCount > 0 ? accent.deep : colors.ink}
            weight={activeFilterCount > 0 ? 'bold' : 'regular'}
          />
          {activeFilterCount > 0 ? (
            <Box
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: accent.solid,
              }}
            />
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}
