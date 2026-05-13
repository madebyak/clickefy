import { View, type ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';

export interface DividerProps {
  /** Direction. Default: horizontal */
  axis?: 'horizontal' | 'vertical';
  /** Color override (defaults to theme.colors.border) */
  color?: string;
  /** Margin around the divider (theme spacing units) */
  spacing?: number;
}

export function Divider({ axis = 'horizontal', color, spacing = 0 }: DividerProps) {
  const theme = useTheme();
  const colors = theme.colors as unknown as Record<string, string>;
  const c = color ? (colors[color] ?? color) : theme.colors.border;

  const style: ViewStyle =
    axis === 'horizontal'
      ? { height: 1, alignSelf: 'stretch', backgroundColor: c, marginVertical: spacing }
      : { width: 1, alignSelf: 'stretch', backgroundColor: c, marginHorizontal: spacing };

  return <View style={style} />;
}
