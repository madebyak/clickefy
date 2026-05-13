/**
 * Spacing scale — strict 4/8 grid. The ONLY values allowed in layouts.
 * Prefer named tokens (`spacing.lg`) over raw numbers.
 */

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
  giant: 72,
} as const;

export type SpacingKey = keyof typeof spacing;
export type SpacingValue = (typeof spacing)[SpacingKey] | number;
