import type { AccentKey, AccentPalette } from '../tokens/accents';
import type { ThemeColors } from '../tokens/colors';
import type { duration, easing, spring } from '../tokens/motion';
import type { radius } from '../tokens/radius';
import type { spacing } from '../tokens/spacing';
import type { fontFamily, typography } from '../tokens/typography';

/** User-selectable theme preference. `system` follows the device. */
export type ThemeMode = 'light' | 'dark' | 'system';

/** Resolved theme — what components actually consume after `system` resolution. */
export type ResolvedScheme = 'light' | 'dark';

export interface Theme {
  /** Active resolved color scheme */
  scheme: ResolvedScheme;
  /** Color tokens for the active scheme */
  colors: ThemeColors;
  /** Active accent palette */
  accent: AccentPalette;
  /** Spacing scale */
  spacing: typeof spacing;
  /** Border radius scale */
  radius: typeof radius;
  /** Typography variants */
  typography: typeof typography;
  /** Font family map */
  fontFamily: typeof fontFamily;
  /** Animation durations */
  duration: typeof duration;
  /** Easing curves */
  easing: typeof easing;
  /** Spring config */
  spring: typeof spring;
}

export interface ThemeContextValue extends Theme {
  /** User's preference (may be 'system') */
  mode: ThemeMode;
  /** User's accent choice */
  accentKey: AccentKey;
  /** Persist a new mode preference */
  setMode: (mode: ThemeMode) => void;
  /** Toggle between light and dark (skips 'system') */
  toggleScheme: () => void;
  /** Persist a new accent choice */
  setAccent: (accent: AccentKey) => void;
}
