/**
 * SearchInput — focused, editable variant of the home `SearchBar`.
 *
 * Visually identical (52pt height, 18 radius, surface bg, border) so
 * the screen-to-screen transition reads as the same affordance
 * "expanding" rather than two separate components — matching how iOS
 * `UISearchBar` and Material 3's `SearchBar` both grow into a search
 * view in place.
 *
 * The component is a thin wrapper around `<TextInput>`:
 *   • leading "back" button (chevron) — collapses to home
 *   • magnifier glyph
 *   • text input (auto-focused on mount)
 *   • clear "x" button when there's text
 *   • optional right "Cancel" affordance — kept on iOS for HIG fidelity
 *     but rendered as a small icon on Android since stock Material
 *     search has no Cancel button
 */

import { Pressable, useTheme } from '@clickfy/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';

export interface SearchInputProps {
  value: string;
  onChangeText: (next: string) => void;
  /** Called when the user submits via the keyboard return key. */
  onSubmit?: (value: string) => void;
  /** Called when the user taps the leading back button. */
  onBack?: () => void;
  placeholder?: string;
  /**
   * Whether to autofocus on mount. Defaults `true`. The search route
   * always opens with the keyboard up; callers can override during
   * tests or when the screen is preloaded.
   */
  autoFocus?: boolean;
}

export function SearchInput({
  value,
  onChangeText,
  onSubmit,
  onBack,
  placeholder,
  autoFocus = true,
}: SearchInputProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('search');
  const inputRef = useRef<TextInput>(null);
  const resolvedPlaceholder = placeholder ?? t('input.placeholder');

  // `autoFocus` on TextInput is unreliable when the route is
  // pre-rendered by Expo Router's stack — focus the input imperatively
  // on mount instead, with a tiny delay so the slide-in animation has
  // started before the keyboard climbs.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [autoFocus]);

  return (
    <View
      style={{
        height: 52,
        paddingStart: 8,
        paddingEnd: 12,
        borderRadius: 18,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <Pressable
        onPress={onBack}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel={t('input.back')}
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="chevronLeft" size={20} color={colors.ink} weight="bold" />
      </Pressable>

      <Icon name="search" size={18} color={colors.inkMuted} />

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={resolvedPlaceholder}
        placeholderTextColor={colors.inkMuted}
        // `web-search` keyboard hint shows a magnifier on the return
        // key on iOS; Android infers the same from `returnKeyType`.
        keyboardType={Platform.OS === 'ios' ? 'web-search' : 'default'}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        // `clearButtonMode` is iOS-only and gives us the native circle-x
        // for free; we render our own button below for Android.
        clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : 'never'}
        onSubmitEditing={() => onSubmit?.(value)}
        style={{
          flex: 1,
          fontSize: 16,
          color: colors.ink,
          paddingVertical: 0,
        }}
      />

      {Platform.OS !== 'ios' && value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel={t('input.clearAccessibilityLabel')}
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="close" size={14} color={colors.inkMuted} weight="bold" />
        </Pressable>
      ) : null}
    </View>
  );
}
