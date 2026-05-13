import { View, type ViewStyle } from 'react-native';

import { Text } from '../primitives/Text';
import { useTheme } from '../theme/ThemeProvider';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'gold';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  /** Optional leading dot/icon */
  leading?: React.ReactNode;
  /** Size variant */
  size?: 'sm' | 'md';
}

/**
 * Badge — compact pill for status, plan tier, count.
 */
export function Badge({ label, tone = 'neutral', leading, size = 'md' }: BadgeProps) {
  const { colors, accent } = useTheme();

  let bg: string;
  let fg: string;
  switch (tone) {
    case 'accent':
      bg = accent.solid;
      fg = accent.ink;
      break;
    case 'success':
      bg = colors.success;
      fg = '#FFFFFF';
      break;
    case 'warning':
      bg = colors.warning;
      fg = '#FFFFFF';
      break;
    case 'danger':
      bg = colors.danger;
      fg = '#FFFFFF';
      break;
    case 'gold':
      bg = '#F0B33A';
      fg = '#3D2A00';
      break;
    case 'neutral':
    default:
      bg = colors.ink;
      fg = colors.surface;
      break;
  }

  const h = size === 'sm' ? 22 : 28;
  const px = size === 'sm' ? 8 : 10;
  const fontSize = size === 'sm' ? 10.5 : 11.5;

  const style: ViewStyle = {
    height: h,
    paddingHorizontal: px,
    borderRadius: h / 2,
    backgroundColor: bg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  };

  return (
    <View style={style}>
      {leading}
      <Text
        color={fg}
        weight="700"
        transform="uppercase"
        style={{ fontSize, lineHeight: fontSize * 1.15, letterSpacing: 0.4 }}
      >
        {label}
      </Text>
    </View>
  );
}
