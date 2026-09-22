/**
 * Logo — official "Clickefy" wordmark, theme-aware.
 *
 * Two-tone SVG (2026-09 brand):
 *   - The "C" mark leads in the brand accent (green by default), the same
 *     glyph that is the app icon.
 *   - The "lickefy" letters use the theme's ink color (black in light
 *     mode, white in dark mode) so they stay legible on the app surface.
 *
 * Paths sourced from `assets/branding/logo-black.svg` + `logo-white.svg`
 * — collapsed into one component so we don't ship two SVGs that differ only
 * by fill color. The aspect ratio is fixed at the artwork's viewBox.
 *
 * Usage:
 *   <Logo width={180} />              // theme-driven colors
 *   <Logo width={120} color="#FFF" /> // force-light (e.g. on dark gradient)
 *   <LogoMark size={64} />            // the "C" glyph alone (splash, avatars)
 */

import { useTheme } from '@clickfy/ui';
import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg';

const VIEWBOX_W = 808.07;
const VIEWBOX_H = 178.65;
const ASPECT = VIEWBOX_W / VIEWBOX_H;

/** The "C" glyph — shared by the wordmark and the standalone mark. */
const MARK_PATH =
  'M41.91,95.52c-5.49-6.06-4.92-14.4-3.44-22.1.91-4.72,2.76-7,6.3-9.98,10.38-8.72,24.59-8.51,34.62,1.89l15.83-14.69c-15.92-16.17-40.78-19.36-59.57-6.29l-8.59,7.13-15.21-13.04c-3.57-3.06-8.63-5.77-11.08-9.84-.67-3.63,3.93-6.38,6.54-8.52C36.96-4.18,75.96-7.25,106.86,15.22c35.32,25.69,43.93,74.01,20.11,110.57-1.36,2.08-2.42,3.07-3.86,4.85-26.86,33.2-73.13,39.84-108.53,15.86-5.27-3.57-10.24-7.09-14.59-12.94l19.49-17.54c2.45-2.2,3.93-5.26,8.07-6.17,17.88,19.98,48.67,20.21,67.53,1.28l-15.98-13.88c-11.32,10.6-26.63,9.93-37.19-1.73Z';

export interface LogoProps {
  /** Width in pt; height auto-derives from the artwork aspect ratio. */
  width?: number;
  /** Override the wordmark color. Defaults to `theme.colors.ink`. */
  color?: string;
  /** Override the "C" mark color. Defaults to `theme.accent.solid`. */
  accentColor?: string;
}

export function Logo({ width = 180, color, accentColor }: LogoProps) {
  const theme = useTheme();
  const wordmarkFill = color ?? theme.colors.ink;
  const accentFill = accentColor ?? theme.accent.solid;
  const height = width / ASPECT;

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      fill="none"
      accessibilityLabel="Clickefy"
    >
      {/* "C" mark — brand accent. */}
      <Path fill={accentFill} d={MARK_PATH} />

      {/* "lickefy" letters — theme ink. */}
      <Path
        fill={wordmarkFill}
        d="M280.54,96.9l23.7,9.44c-7.45,18.27-23.54,31.14-43.11,34.69-15.73,2.85-32.39,1.37-45.85-6.99-7.77-4.82-14.94-10.66-19.48-18.31-3.29-5.53-6.64-11.31-8.21-17.33-4.15-15.92-3.4-31.54,2.91-46.75,11.41-27.5,40.73-41.79,70.31-36.03,19.45,4.14,35.08,16.88,43.07,35.77l-23.15,9.87c-5.2-12.38-15.97-20.44-29.45-21.51-10.9-.87-21.46,2.03-29.3,10.1-13.59,13.99-15.2,36.25-3.93,52.26,8.15,11.59,21.91,16.61,35.69,14.56,11.54-1.72,21.21-8.25,26.81-19.78Z"
      />
      <Polygon
        fill={wordmarkFill}
        points="567.24 140.05 537.62 140.17 513.45 112.81 503.51 102.69 503.36 140.16 480.21 140.01 480.17 13.09 503.3 13.08 503.52 89.76 535.52 53.09 565.05 53.56 527.23 94.9 567.24 140.05"
      />
      <Path
        fill={wordmarkFill}
        d="M770.22,153.34c-7.08,19.19-24.42,28.45-43.32,24.35l.25-21.78c5.61,1.25,10.82.57,15.33-1.98s6.42-7.53,8.45-13.74l-25.07-62.47-9.88-24.31,26.21-.23,20.81,58.3,18.99-58.48,26.07.11-37.85,100.22Z"
      />
      <Path
        fill={wordmarkFill}
        d="M448.83,107.94l22.06,9.8c-7.19,14.68-20.63,24.02-36.5,24.64-4,.16-8.61.71-12.43-.36-4.25-1.19-8.83-2.18-12.69-4.42-4.91-2.85-10.07-6.34-13.55-10.86-13.83-17.95-13.71-43.3.57-60.59,9.46-11.46,23.44-16.09,37.98-15.35,16.29.83,30.25,9.94,36.55,25.52l-21.88,9.01c-2.51-6.64-8.03-10.45-13.59-11.57-7.18-1.45-14.1.26-19.06,5.41-9.59,9.96-9.02,27.18,1.31,36.22,5.19,4.54,11.57,6.02,18.42,4.37,5.36-1.29,10.64-5.28,12.8-11.83Z"
      />
      <Path
        fill={wordmarkFill}
        d="M693.03,75.12l-.1,65.1-23.24.16-.06-64.78-14.26-.39v-22.1s14.05-.1,14.05-.1l.53-14.75c.31-8.52,4.67-16.79,11.91-21.58,9.12-6.05,20.28-6.44,30.76-4.17v21.72c-4.83-.82-8.92-1.38-13.2.02-6.25,2.04-7.08,10.57-6.36,19.07l19.38-.1-.07,21.84-19.34.06Z"
      />
      <Rect fill={wordmarkFill} x={314.28} y={13.08} width={23.47} height={127.27} />
      <Rect
        fill={wordmarkFill}
        x={320.34}
        y={84.8}
        width={87.24}
        height={23.8}
        transform="translate(267.09 460.62) rotate(-89.97)"
      />
      <Circle fill={wordmarkFill} cx={364.22} cy={27.02} r={14.59} />
      <Path
        fill={wordmarkFill}
        d="M627.9,111.24l20.16,9.61c-5.1,9.1-12.56,15.78-22.14,18.89-27.41,8.92-56.97-4.59-62.01-33.51-2.42-13.89.2-28.34,9.14-39.49,10.5-13.08,27.64-18.35,44.07-15.34,24.26,4.44,36.95,27.74,34.24,52.74l-64.29.05c2.22,12.68,14.96,20.03,27.44,17.06,5.64-1.08,10.21-3.85,13.4-10.01ZM627.74,87.83c-1.11-9.7-8.32-15.13-16.67-16.61-11.48-1.68-21.85,5.07-23.75,16.77l40.43-.16Z"
      />
    </Svg>
  );
}

/** Convenience helper for layouts that need to reserve the right amount of space. */
export function getLogoHeight(width: number): number {
  return width / ASPECT;
}

// The mark's own crop, taken verbatim from assets/branding/icon.svg —
// the same glyph shipped as the app icon.
const MARK_W = 140.39;
const MARK_H = 160.84;

export interface LogoMarkProps {
  /** Rendered height in pt; width auto-derives from the glyph aspect. */
  size?: number;
  /** Override the fill. Defaults to `theme.accent.solid`. */
  color?: string;
}

/** The "C" glyph alone — splash screens, avatars, compact headers. */
export function LogoMark({ size = 64, color }: LogoMarkProps) {
  const theme = useTheme();
  return (
    <Svg
      width={(size * MARK_W) / MARK_H}
      height={size}
      viewBox={`0 0 ${MARK_W} ${MARK_H}`}
      fill="none"
      accessibilityLabel="Clickefy"
    >
      <Path fill={color ?? theme.accent.solid} d={MARK_PATH} />
    </Svg>
  );
}
