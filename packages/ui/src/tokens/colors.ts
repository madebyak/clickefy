/**
 * Color tokens — light + dark themes.
 * Mirrors `app-ui-refrence/Clickfy.ai/app/clickfy-tokens.jsx` exactly so the
 * mobile app and the design prototype stay visually aligned.
 *
 * Convention: every screen consumes `useTheme().colors.*` — never hardcode hex.
 */

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceElev: string;
  surfaceMuted: string;

  ink: string;
  inkMuted: string;
  inkSubtle: string;

  border: string;
  borderStrong: string;

  // Inverted chip surface (dark chip on light theme, white chip on dark theme)
  chipBg: string;
  chipInk: string;
  pill: string;

  // Semantic
  success: string;
  warning: string;
  danger: string;

  // Overlays — used for sheets, modals, scrim
  overlay: string;
  overlayStrong: string;

  // Glass — translucent surface for floating buttons on media
  glass: string;
  glassInk: string;
}

export const lightColors: ThemeColors = {
  bg: '#F4F2EE',
  surface: '#FFFFFF',
  surfaceElev: '#FFFFFF',
  surfaceMuted: '#F7F6F3',
  ink: '#0B0B12',
  inkMuted: '#6E6B78',
  inkSubtle: '#A09DAA',
  border: '#ECEAE3',
  borderStrong: '#D9D6CD',
  chipBg: '#0B0B12',
  chipInk: '#FFFFFF',
  pill: '#0B0B12',
  success: '#10B981',
  warning: '#F59022',
  danger: '#FF4D6F',
  overlay: 'rgba(11, 11, 18, 0.45)',
  overlayStrong: 'rgba(11, 11, 18, 0.65)',
  glass: 'rgba(255, 255, 255, 0.92)',
  glassInk: '#0B0B12',
};

export const darkColors: ThemeColors = {
  bg: '#0A0A10',
  surface: '#14141C',
  surfaceElev: '#1B1B25',
  surfaceMuted: '#101019',
  ink: '#FFFFFF',
  inkMuted: '#9B98A8',
  inkSubtle: '#62606E',
  border: '#22222E',
  borderStrong: '#2C2C3A',
  chipBg: '#FFFFFF',
  chipInk: '#0B0B12',
  pill: '#FFFFFF',
  success: '#10B981',
  warning: '#F59022',
  danger: '#FF4D6F',
  overlay: 'rgba(0, 0, 0, 0.55)',
  overlayStrong: 'rgba(0, 0, 0, 0.75)',
  glass: 'rgba(255, 255, 255, 0.88)',
  glassInk: '#0B0B12',
};
