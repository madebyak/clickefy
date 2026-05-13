import { forwardRef } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import type { TypographyVariantKey } from '../tokens/typography';

export interface TextProps extends Omit<RNTextProps, 'style'> {
  /** Type-scale variant. Default: `body`. */
  variant?: TypographyVariantKey;
  /** Color token name (`ink`, `inkMuted`, `inkSubtle`, `accent`, etc) or raw hex. */
  color?: string;
  /** Override font weight (rarely needed — variants set this) */
  weight?: TextStyle['fontWeight'];
  /** Text alignment */
  align?: TextStyle['textAlign'];
  /** Transform — uppercase typically used with `overline` variant */
  transform?: TextStyle['textTransform'];
  /** Truncate after N lines */
  numberOfLines?: number;
  /** Italic — uses display italic when variant is `display`, otherwise CSS italic */
  italic?: boolean;
  /** Optional escape hatch */
  style?: TextStyle | TextStyle[];
  /** Optional opacity */
  opacity?: number;
}

/**
 * Text — themed type primitive. ALWAYS use this instead of `<RNText>` so the
 * font family, scale, and color come from the design system.
 */
export const Text = forwardRef<RNText, TextProps>(function Text(
  { variant = 'body', color, weight, align, transform, italic, style, opacity, ...rest },
  ref,
) {
  const theme = useTheme();
  const v = theme.typography[variant] as {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    letterSpacing?: number;
    fontWeight?: TextStyle['fontWeight'];
  };
  const colors = theme.colors as unknown as Record<string, string>;

  const resolvedColor =
    color === undefined ? colors.ink : (colors[color] ?? color);

  const composed: TextStyle = {
    fontFamily:
      italic && variant === 'display' ? theme.fontFamily.displayItalic : v.fontFamily,
    fontSize: v.fontSize,
    lineHeight: v.lineHeight,
    letterSpacing: v.letterSpacing,
    fontWeight: weight ?? v.fontWeight,
    color: resolvedColor,
    textAlign: align,
    textTransform: transform,
    fontStyle: italic && variant !== 'display' ? 'italic' : undefined,
    opacity,
  };

  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  return <RNText ref={ref} {...rest} style={[composed, flat]} />;
});
