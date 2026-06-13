/**
 * Search filters — modal sheet presented from the search screen.
 *
 * Presented as an iOS-native pageSheet (`presentation: 'modal'` in
 * the stack config) — same pattern used by `/report`, `/edit-profile`
 * and `/template/[id]`. We deliberately do NOT pull in
 * `@gorhom/bottom-sheet`: the codebase has zero existing usages, the
 * native sheet matches platform conventions on both iOS and Android,
 * and it doesn't fight `expo-router`'s navigation model.
 *
 * Sheet contract:
 *   • Opens with a "pending" copy of the live filters. The user can
 *     toggle without affecting search results until they tap "Apply"
 *     — this matches Apple's HIG (see Maps' Filters sheet) and the
 *     Material 3 filter sheet pattern. Dismissing without applying
 *     reverts to the previous state.
 *   • A live "Show X results" CTA computes the prospective count
 *     against the *current query string* + the *pending filters* via
 *     a count-only `withCount=true` request. Debounced 200ms so rapid
 *     toggles don't fire intermediate requests.
 *   • "Reset" sets the pending state back to defaults (does NOT apply).
 */

import { Box, Button, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import {
  countActiveFilters,
  getSearchFilters,
  resetSearchFilters,
  setSearchFilters,
  type SearchFilters,
  type TemplateKindFilter,
  type TemplateSortFilter,
} from '@/lib/search-state';
import { getSDK } from '@/lib/sdk';

const KIND_OPTIONS: { value: TemplateKindFilter; labelKey: string; icon: 'image' | 'play' | 'imageStack' }[] = [
  { value: 'image', labelKey: 'kind.image', icon: 'image' },
  { value: 'video', labelKey: 'kind.video', icon: 'play' },
  { value: 'image_set', labelKey: 'kind.set', icon: 'imageStack' },
];

const SORT_OPTIONS: { value: TemplateSortFilter; labelKey: string; descriptionKey: string }[] = [
  { value: 'default', labelKey: 'filtersSheet.sort.default.label', descriptionKey: 'filtersSheet.sort.default.description' },
  { value: 'recent', labelKey: 'filtersSheet.sort.recent.label', descriptionKey: 'filtersSheet.sort.recent.description' },
  { value: 'popular', labelKey: 'filtersSheet.sort.popular.label', descriptionKey: 'filtersSheet.sort.popular.description' },
];

export default function SearchFiltersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, accent } = useTheme();
  const { t } = useTranslation('search');
  const sdk = getSDK();
  // The search screen passes its current query through navigation
  // params so the count preview reflects "templates matching this
  // query AND these pending filters" — not just the filters.
  const params = useLocalSearchParams<{ q?: string }>();
  const queryString = (params.q ?? '').trim();

  const [pending, setPending] = useState<SearchFilters>(() => getSearchFilters());

  // Debounced count fetch. Mirrors the listTemplates request the
  // search screen would issue if these filters were applied — but
  // limit=1 since we only care about the `total` value. Keeps the
  // payload tiny.
  const [countKey, setCountKey] = useState(pending);
  useEffect(() => {
    const t = setTimeout(() => setCountKey(pending), 200);
    return () => clearTimeout(t);
  }, [pending]);

  const countQuery = useQuery({
    queryKey: ['search-count', queryString, countKey] as const,
    queryFn: () =>
      sdk.catalog.listTemplates({
        search: queryString || undefined,
        kind: countKey.kind,
        // Honor the active category scope in the live count preview —
        // otherwise "Show 12 results" would lie when the user has a
        // category-scoped search open and only toggles a kind/sort.
        categoryId: countKey.categoryId,
        featured: countKey.featured,
        sort: countKey.sort,
        limit: 1,
        withCount: true,
      }),
    staleTime: 30_000,
    gcTime: 60_000,
  });

  const total = countQuery.data?.total;
  const apply = () => {
    setSearchFilters(pending);
    router.back();
  };

  const reset = () => {
    // Reset the pending state only; the user still has to tap Apply
    // to commit. Two-step confirmation matches both HIG and Material.
    //
    // We deliberately preserve the active category scope — the
    // "Reset" button clears *toggled* filters, not the user's current
    // surface. Clearing the scope is a separate gesture (the leading
    // "In <Label> ✕" chip on `/search`).
    setPending((p) => ({
      sort: 'default',
      categoryId: p.categoryId,
      categoryLabel: p.categoryLabel,
    }));
  };

  const pendingActive = countActiveFilters(pending);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Sheet handle row — visual cue that the surface is dismissable
          by drag. Mirrors the iOS native pageSheet grabber. */}
      <View style={{ alignItems: 'center', paddingTop: 8 }}>
        <View
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: colors.border,
          }}
        />
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 8,
        }}
      >
        <Text variant="title" color="ink" weight="700" style={{ fontSize: 22 }}>
          {t('filtersSheet.title')}
        </Text>
        <Pressable
          onPress={() => router.back()}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel={t('filtersSheet.close')}
          style={{
            width: 36,
            height: 36,
            borderRadius: 12,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="close" size={18} color={colors.ink} weight="bold" />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 24 }}
      >
        {/* ── Type ─────────────────────────────────────────────── */}
        <Stack gap="sm">
          <Text variant="overline" color="inkMuted" transform="uppercase">
            {t('filtersSheet.sections.type')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {KIND_OPTIONS.map((opt) => {
              const active = pending.kind === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() =>
                    setPending((p) => ({
                      ...p,
                      kind: p.kind === opt.value ? undefined : opt.value,
                    }))
                  }
                  haptic="selection"
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    flex: 1,
                    height: 84,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: active ? colors.ink : colors.border,
                    backgroundColor: active ? colors.ink : colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <Icon
                    name={opt.icon}
                    size={20}
                    color={active ? colors.surface : colors.ink}
                    weight="bold"
                  />
                  <Text
                    variant="caption"
                    weight="600"
                    style={{
                      fontSize: 13,
                      color: active ? colors.surface : colors.ink,
                    }}
                  >
                    {t(opt.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Stack>

        {/* ── Featured ─────────────────────────────────────────── */}
        <Stack gap="sm">
          <Text variant="overline" color="inkMuted" transform="uppercase">
            {t('filtersSheet.sections.featured')}
          </Text>
          <Pressable
            onPress={() =>
              setPending((p) => ({ ...p, featured: p.featured ? undefined : true }))
            }
            haptic="selection"
            accessibilityRole="switch"
            accessibilityState={{ checked: !!pending.featured }}
            style={{
              minHeight: 56,
              padding: 14,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: pending.featured ? accent.solid : colors.border,
              backgroundColor: colors.surface,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: pending.featured ? accent.soft : colors.surfaceMuted,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon
                name="star"
                size={16}
                color={pending.featured ? accent.deep : colors.inkMuted}
                weight={pending.featured ? 'fill' : 'regular'}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodySemi" color="ink">
                {t('filtersSheet.featured.title')}
              </Text>
              <Text variant="caption" color="inkMuted">
                {t('filtersSheet.featured.description')}
              </Text>
            </View>
            {pending.featured ? (
              <Icon name="check" size={18} color={accent.solid} weight="bold" />
            ) : null}
          </Pressable>
        </Stack>

        {/* ── Sort ─────────────────────────────────────────────── */}
        <Stack gap="sm">
          <Text variant="overline" color="inkMuted" transform="uppercase">
            {t('filtersSheet.sections.sort')}
          </Text>
          <View style={{ gap: 8 }}>
            {SORT_OPTIONS.map((opt) => {
              const active = pending.sort === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setPending((p) => ({ ...p, sort: opt.value }))}
                  haptic="selection"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{
                    minHeight: 56,
                    padding: 14,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: active ? colors.ink : colors.border,
                    backgroundColor: colors.surface,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="bodySemi" color="ink">
                      {t(opt.labelKey)}
                    </Text>
                    <Text variant="caption" color="inkMuted">
                      {t(opt.descriptionKey)}
                    </Text>
                  </View>
                  {active ? (
                    <Icon name="check" size={18} color={colors.ink} weight="bold" />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Stack>
      </ScrollView>

      {/* Sticky CTA — Reset (text) + Apply (primary). Live total count
          on the Apply button. Reset is intentionally low-emphasis so
          users don't tap it by mistake. */}
      <Box
        style={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          borderTopWidth: 1,
          borderColor: colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: colors.bg,
        }}
      >
        <Pressable
          onPress={reset}
          haptic="light"
          disabled={pendingActive === 0}
          accessibilityRole="button"
          accessibilityLabel={t('filtersSheet.resetAccessibilityLabel')}
          style={{
            height: 48,
            paddingHorizontal: 18,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pendingActive === 0 ? 0.4 : 1,
          }}
        >
          <Text variant="bodySemi" color="ink" weight="600">
            {t('filtersSheet.reset')}
          </Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Button
            onPress={apply}
            variant="primary"
            full
            disabled={total === 0}
          >
            {countQuery.isLoading
              ? t('filtersSheet.apply')
              : total !== undefined
                ? t('filtersSheet.applyCount', { count: total, formatted: formatCount(total) })
                : t('filtersSheet.apply')}
          </Button>
        </View>
      </Box>
    </View>
  );
}

// Mirrors the formatter in `app/search.tsx` — kept local so the file
// has no incoming dep beyond the shared store.
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}

// `resetSearchFilters` is imported above for tree-shake purity even
// though `reset` here only manipulates local pending state. Kept the
// import in case we ever want a "reset and apply" affordance.
void resetSearchFilters;
