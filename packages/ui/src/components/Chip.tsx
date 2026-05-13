import { Pressable, type HapticType } from '../primitives/Pressable';
import { Text } from '../primitives/Text';
import { useTheme } from '../theme/ThemeProvider';

export type ChipSize = 'sm' | 'md';

export interface ChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
  size?: ChipSize;
  /** Optional leading element (icon, dot) */
  leading?: React.ReactNode;
  haptic?: HapticType;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * Chip — pill-shaped selectable tag. Used for filters (Image / Video / Set),
 * aspect ratios, and other compact toggles.
 */
export function Chip({
  label,
  active,
  onPress,
  size = 'md',
  leading,
  haptic = 'selection',
  disabled,
}: ChipProps) {
  const { colors } = useTheme();
  const h = size === 'sm' ? 30 : 34;
  const px = size === 'sm' ? 12 : 14;
  const fontSize = size === 'sm' ? 12.5 : 13;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      haptic={haptic}
      pressedOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      style={{
        height: h,
        paddingHorizontal: px,
        borderRadius: h / 2,
        borderWidth: 1,
        borderColor: active ? colors.ink : colors.border,
        backgroundColor: active ? colors.ink : colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: disabled ? 0.5 : 1,
        alignSelf: 'flex-start',
      }}
    >
      {leading}
      <Text
        variant="caption"
        color={active ? colors.surface : colors.ink}
        weight={active ? '600' : '500'}
        style={{ fontSize, lineHeight: fontSize * 1.2, letterSpacing: -0.1 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
