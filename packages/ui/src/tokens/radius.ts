/**
 * Border radius scale.
 * - `pill` = fully rounded for pills/buttons (use a large number, RN clamps).
 * - `card` = primary card radius (matches prototype's 18px template card).
 */

export const radius = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 14,
  card: 18,
  xl: 22,
  xxl: 28,
  pill: 999,
} as const;

export type RadiusKey = keyof typeof radius;
