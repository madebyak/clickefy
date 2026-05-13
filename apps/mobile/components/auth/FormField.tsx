/**
 * FormField — labeled text input used across the auth flow.
 *
 * Presentational only — wire it to `react-hook-form` via `<Controller>`.
 * Handles focus state, error state (red border + helper text), optional
 * leading icon, and consistent typography across sign-in / sign-up.
 *
 * Design rules:
 *   - 56pt tall (44pt iOS minimum + breathing room).
 *   - Border darkens on focus, turns danger on error.
 *   - Helper / error text reserves 18pt of space below so the layout
 *     doesn't jump when an error appears.
 */

import { useTheme } from '@clickfy/ui';
import { forwardRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';

export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** Optional Phosphor icon rendered on the left of the field. */
  leadingIcon?: IconName;
  /** Helper text shown below in the muted color. */
  helper?: string;
  /** Error text — when set, overrides `helper` and switches field to danger state. */
  error?: string;
  /** Right-side accessory (e.g. clear button). Should be ~24pt. */
  trailing?: React.ReactNode;
}

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  {
    label,
    leadingIcon,
    helper,
    error,
    trailing,
    onFocus,
    onBlur,
    ...inputProps
  },
  ref,
) {
  const { colors, accent } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? colors.danger
    : focused
      ? accent.solid
      : colors.border;

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text style={[styles.label, { color: colors.inkMuted }]}>{label}</Text>
      ) : null}

      <View
        style={[
          styles.fieldRow,
          {
            backgroundColor: colors.surface,
            borderColor,
            borderWidth: focused || !!error ? 1.5 : 1,
          },
        ]}
      >
        {leadingIcon ? (
          <Icon name={leadingIcon} size={18} color={error ? colors.danger : colors.inkMuted} />
        ) : null}

        <TextInput
          ref={ref}
          placeholderTextColor={colors.inkMuted}
          selectionColor={accent.solid}
          {...inputProps}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: colors.ink }]}
        />

        {trailing}
      </View>

      <Text
        style={[
          styles.helper,
          { color: error ? colors.danger : colors.inkSubtle },
        ]}
        numberOfLines={1}
      >
        {error ?? helper ?? ''}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  label: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  fieldRow: {
    height: 56,
    borderRadius: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Geist_500Medium',
    letterSpacing: -0.1,
    paddingVertical: 0, // RN Android default padding makes the field taller
  },
  helper: {
    fontFamily: 'Geist_500Medium',
    fontSize: 12.5,
    letterSpacing: 0.05,
    lineHeight: 16,
    minHeight: 16,
    paddingHorizontal: 4,
  },
});
