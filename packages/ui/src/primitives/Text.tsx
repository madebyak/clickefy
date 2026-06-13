import { forwardRef } from 'react';
import {
  I18nManager,
  StyleSheet,
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import type { TypographyVariantKey } from '../tokens/typography';

/**
 * Alignment accepted by `<Text align>` / `style.textAlign`. We add the logical
 * `start` / `end` (which RN's `textAlign` does not natively support) so callers
 * express intent ("reading edge") instead of guessing a physical side.
 */
export type LogicalTextAlign =
  | 'start'
  | 'end'
  | 'left'
  | 'right'
  | 'center'
  | 'auto'
  | 'justify';

/**
 * Resolve a logical/physical alignment to the PHYSICAL `textAlign` value that
 * renders on the intended visual edge — accounting for React Native's RTL
 * left/right swap.
 *
 * Why this is needed: when a subtree is RTL and `I18nManager.doLeftAndRightSwapInRTL`
 * is true (the RN default), RN swaps `textAlign: 'left' <-> 'right'`. So naively
 * setting `textAlign: 'right'` for RTL renders on the LEFT. We compute the
 * physical side we want, then pre-invert it when the swap is active so the final
 * on-screen result lands where intended. Verified against an on-device probe
 * (`textAlign:'left'` rendered on the right under RTL).
 */
function resolveTextAlign(
  input: LogicalTextAlign | undefined,
  isRTL: boolean,
): TextStyle['textAlign'] {
  const align = input ?? 'start';

  // Direction-agnostic values pass through untouched.
  if (align === 'center' || align === 'auto' || align === 'justify') {
    return align;
  }

  // Which visual edge do we ultimately want the text on?
  const wantsVisualRight =
    align === 'start' ? isRTL : align === 'end' ? !isRTL : align === 'right';

  const physical: 'left' | 'right' = wantsVisualRight ? 'right' : 'left';

  // RN swaps left<->right in RTL subtrees, so request the opposite physical
  // value when the swap is active — the swap then lands it on the right edge.
  if (isRTL && I18nManager.doLeftAndRightSwapInRTL) {
    return physical === 'right' ? 'left' : 'right';
  }
  return physical;
}

export interface TextProps extends Omit<RNTextProps, 'style'> {
  /** Type-scale variant. Default: `body`. */
  variant?: TypographyVariantKey;
  /** Color token name (`ink`, `inkMuted`, `inkSubtle`, `accent`, etc) or raw hex. */
  color?: string;
  /** Override font weight (rarely needed — variants set this) */
  weight?: TextStyle['fontWeight'];
  /**
   * Text alignment. Prefer the logical `start` / `end` so RTL is handled for
   * you; `left` / `right` are still accepted and RTL-corrected.
   * Defaults to `start` (the reading edge).
   */
  align?: LogicalTextAlign;
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
 * font family, scale, color, and RTL-correct alignment come from the design
 * system.
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

  // Flatten the passed style (handles arrays, registered IDs, falsy entries)
  // so we can read any `textAlign` the caller set and route it through the same
  // RTL-aware resolver.
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;

  const resolvedTextAlign = resolveTextAlign(
    (align ?? (flat.textAlign as LogicalTextAlign | undefined)),
    theme.isRTL,
  );

  const composed: TextStyle = {
    fontFamily:
      italic && variant === 'display' ? theme.fontFamily.displayItalic : v.fontFamily,
    fontSize: v.fontSize,
    lineHeight: v.lineHeight,
    letterSpacing: v.letterSpacing,
    fontWeight: weight ?? v.fontWeight,
    color: resolvedColor,
    textTransform: transform,
    fontStyle: italic && variant !== 'display' ? 'italic' : undefined,
    opacity,
  };

  return (
    <RNText
      ref={ref}
      {...rest}
      // `flat` last so caller styles win — except `textAlign`, which we always
      // route through the resolver so a raw `textAlign: 'right'` still renders
      // correctly under RTL.
      style={[composed, flat, { textAlign: resolvedTextAlign }]}
    />
  );
});
