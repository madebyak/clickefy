/**
 * PasswordField — secure text input for the auth flow.
 *
 * Thin wrapper around `FormField` that adds:
 *   - a leading lock icon (overridable),
 *   - a show/hide (eye) toggle as the trailing accessory,
 *   - sensible secure-entry defaults (no autocorrect/capitalize).
 *
 * Wire it to `react-hook-form` via `<Controller>` exactly like `FormField`.
 * Set `variant="new"` on sign-up / reset screens so the OS offers a strong
 * password and stores it in the keychain; `variant="current"` on sign-in so
 * the OS offers the saved credential instead.
 */

import { useTheme } from '@clickfy/ui';
import { forwardRef, useState } from 'react';
import { Pressable, type TextInput } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { FormField, type FormFieldProps } from '@/components/auth/FormField';

export interface PasswordFieldProps
  extends Omit<FormFieldProps, 'secureTextEntry' | 'trailing' | 'leadingIcon'> {
  /**
   * `current` → existing password (sign-in): `textContentType="password"`.
   * `new` → password being created (sign-up / reset): `textContentType="newPassword"`
   * so the OS suggests + saves a strong password.
   */
  variant?: 'current' | 'new';
}

export const PasswordField = forwardRef<TextInput, PasswordFieldProps>(
  function PasswordField({ variant = 'current', ...props }, ref) {
    const { colors } = useTheme();
    const [visible, setVisible] = useState(false);

    return (
      <FormField
        ref={ref}
        leadingIcon="lock"
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType={variant === 'new' ? 'newPassword' : 'password'}
        autoComplete={variant === 'new' ? 'password-new' : 'password'}
        trailing={
          <Pressable
            onPress={() => setVisible((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            style={{ padding: 4 }}
          >
            <Icon
              name={visible ? 'eyeOff' : 'eye'}
              size={18}
              color={colors.inkMuted}
            />
          </Pressable>
        }
        {...props}
      />
    );
  },
);
