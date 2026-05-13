import { forwardRef } from 'react';
import { View, type ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import type { SpacingKey } from '../tokens/spacing';
import { Box, type BoxProps } from './Box';

type GapProp = SpacingKey | number;

export interface StackProps extends BoxProps {
  /** Direction. Default: column (vertical). */
  direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  /** Gap between children — uses theme.spacing or raw number. */
  gap?: GapProp;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: ViewStyle['flexWrap'];
}

/**
 * Stack — flex layout primitive. Replaces 95% of `View` + `style.flexDirection`
 * snippets. `gap` works because RN >=0.71 supports flex gap.
 */
export const Stack = forwardRef<View, StackProps>(function Stack(
  { direction = 'column', gap, align, justify, wrap, style, ...rest },
  ref,
) {
  const theme = useTheme();
  const resolvedGap =
    gap === undefined ? undefined : typeof gap === 'number' ? gap : theme.spacing[gap];

  const layout: ViewStyle = {
    flexDirection: direction,
    gap: resolvedGap,
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap,
  };

  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  return <Box ref={ref} {...rest} style={[layout, flat]} />;
});

/** Convenience — horizontal stack. */
export const HStack = forwardRef<View, Omit<StackProps, 'direction'>>(function HStack(props, ref) {
  return <Stack ref={ref} direction="row" {...props} />;
});

/** Convenience — vertical stack (alias of Stack). */
export const VStack = forwardRef<View, Omit<StackProps, 'direction'>>(function VStack(props, ref) {
  return <Stack ref={ref} direction="column" {...props} />;
});
