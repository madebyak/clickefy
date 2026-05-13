import { forwardRef } from 'react';
import { View, type ViewProps, type ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import type { SpacingKey } from '../tokens/spacing';
import type { RadiusKey } from '../tokens/radius';

type SpacingProp = SpacingKey | number;
type RadiusProp = RadiusKey | number;

/**
 * Box — themed View primitive with semantic style props.
 *
 * Use it whenever you'd reach for `<View>`. It removes 90% of the boilerplate
 * `StyleSheet.create({ container: { padding: 16 } })` calls.
 *
 * Example:
 *   <Box p="lg" bg="surface" radius="card">
 *     <Text>Hello</Text>
 *   </Box>
 */
export interface BoxProps extends Omit<ViewProps, 'style'> {
  // Padding — `p` overrides; axis/side props refine it.
  p?: SpacingProp;
  px?: SpacingProp;
  py?: SpacingProp;
  pt?: SpacingProp;
  pr?: SpacingProp;
  pb?: SpacingProp;
  pl?: SpacingProp;
  // Margin
  m?: SpacingProp;
  mx?: SpacingProp;
  my?: SpacingProp;
  mt?: SpacingProp;
  mr?: SpacingProp;
  mb?: SpacingProp;
  ml?: SpacingProp;
  // Layout
  flex?: ViewStyle['flex'];
  width?: ViewStyle['width'];
  height?: ViewStyle['height'];
  minWidth?: ViewStyle['minWidth'];
  minHeight?: ViewStyle['minHeight'];
  maxWidth?: ViewStyle['maxWidth'];
  maxHeight?: ViewStyle['maxHeight'];
  // Surface
  bg?: keyof ReturnType<typeof useTheme>['colors'] | string;
  border?: keyof ReturnType<typeof useTheme>['colors'] | string;
  borderWidth?: number;
  radius?: RadiusProp;
  /** Shorthand for absolute positioning */
  position?: ViewStyle['position'];
  top?: ViewStyle['top'];
  left?: ViewStyle['left'];
  right?: ViewStyle['right'];
  bottom?: ViewStyle['bottom'];
  zIndex?: number;
  overflow?: ViewStyle['overflow'];
  opacity?: number;
  /** Optional escape hatch — additional styles merged in last */
  style?: ViewStyle | ViewStyle[];
}

export const Box = forwardRef<View, BoxProps>(function Box(
  {
    p,
    px,
    py,
    pt,
    pr,
    pb,
    pl,
    m,
    mx,
    my,
    mt,
    mr,
    mb,
    ml,
    flex,
    width,
    height,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    bg,
    border,
    borderWidth,
    radius,
    position,
    top,
    left,
    right,
    bottom,
    zIndex,
    overflow,
    opacity,
    style,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const sp = theme.spacing;
  const rd = theme.radius;
  const colors = theme.colors as unknown as Record<string, string>;

  const resolveSpacing = (v: SpacingProp | undefined): number | undefined =>
    v === undefined ? undefined : typeof v === 'number' ? v : sp[v];

  const resolveRadius = (v: RadiusProp | undefined): number | undefined =>
    v === undefined ? undefined : typeof v === 'number' ? v : rd[v];

  const resolveColor = (v: string | undefined): string | undefined =>
    v === undefined ? undefined : (colors[v] ?? v);

  const composed: ViewStyle = {
    padding: resolveSpacing(p),
    paddingHorizontal: resolveSpacing(px),
    paddingVertical: resolveSpacing(py),
    paddingTop: resolveSpacing(pt),
    paddingRight: resolveSpacing(pr),
    paddingBottom: resolveSpacing(pb),
    paddingLeft: resolveSpacing(pl),
    margin: resolveSpacing(m),
    marginHorizontal: resolveSpacing(mx),
    marginVertical: resolveSpacing(my),
    marginTop: resolveSpacing(mt),
    marginRight: resolveSpacing(mr),
    marginBottom: resolveSpacing(mb),
    marginLeft: resolveSpacing(ml),
    flex,
    width,
    height,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    backgroundColor: resolveColor(bg),
    borderColor: resolveColor(border),
    borderWidth: border !== undefined && borderWidth === undefined ? 1 : borderWidth,
    borderRadius: resolveRadius(radius),
    position,
    top,
    left,
    right,
    bottom,
    zIndex,
    overflow,
    opacity,
  };

  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  return <View ref={ref} {...rest} style={[composed, flat]} />;
});
