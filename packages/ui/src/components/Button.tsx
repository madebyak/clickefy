import { ActivityIndicator, type ViewStyle } from 'react-native';

import { Pressable, type HapticType } from '../primitives/Pressable';
import { Text } from '../primitives/Text';
import { useTheme } from '../theme/ThemeProvider';

export type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'soft' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to container width */
  full?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading icon node */
  leading?: React.ReactNode;
  /** Optional trailing icon node */
  trailing?: React.ReactNode;
  haptic?: HapticType;
  /** Accessible label override */
  accessibilityLabel?: string;
  /** Test id */
  testID?: string;
}

const SIZES: Record<ButtonSize, { height: number; px: number; fontSize: number; gap: number }> = {
  sm: { height: 36, px: 14, fontSize: 13.5, gap: 6 },
  md: { height: 48, px: 22, fontSize: 15.5, gap: 8 },
  lg: { height: 56, px: 26, fontSize: 16.5, gap: 10 },
};

/**
 * Button — primary CTA component with 5 variants matching the prototype.
 *
 * variant=
 *   - `primary` : ink-on-surface (high contrast, default action)
 *   - `accent`  : gradient brand button (paywall, generate, premium CTAs)
 *   - `ghost`   : surface w/ border (secondary action)
 *   - `soft`    : tinted accent.soft (tertiary, less prominent)
 *   - `danger`  : destructive (sign out, delete)
 */
export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  full,
  disabled,
  loading,
  leading,
  trailing,
  haptic = 'light',
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const theme = useTheme();
  const { colors, accent } = theme;
  const sz = SIZES[size];

  // Compose visual style per variant.
  let base: ViewStyle;
  let labelColor: string;
  switch (variant) {
    case 'accent':
      base = {
        backgroundColor: accent.solid,
        // Gradient via shadow + solid is "good enough" until we add expo-linear-gradient.
        shadowColor: accent.solid,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 18,
        elevation: 6,
      };
      labelColor = accent.ink;
      break;
    case 'ghost':
      base = {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      };
      labelColor = colors.ink;
      break;
    case 'soft':
      base = { backgroundColor: accent.soft };
      labelColor = accent.deep;
      break;
    case 'danger':
      base = { backgroundColor: colors.danger };
      labelColor = '#FFFFFF';
      break;
    case 'primary':
    default:
      base = {
        backgroundColor: colors.ink,
        shadowColor: colors.ink,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
        elevation: 4,
      };
      labelColor = colors.surface;
      break;
  }

  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      haptic={haptic}
      pressedOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      style={[
        {
          height: sz.height,
          paddingHorizontal: sz.px,
          borderRadius: sz.height / 2,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: sz.gap,
          alignSelf: full ? 'stretch' : 'flex-start',
          opacity: isDisabled ? 0.5 : 1,
        },
        base,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={labelColor} />
      ) : (
        <>
          {leading}
          <Text
            variant="bodySemi"
            color={labelColor}
            style={{
              fontSize: sz.fontSize,
              lineHeight: sz.fontSize * 1.2,
              letterSpacing: -0.2,
            }}
          >
            {children}
          </Text>
          {trailing}
        </>
      )}
    </Pressable>
  );
}
