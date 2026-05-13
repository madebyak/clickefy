/**
 * Logo — official "Clickefy.Ai" wordmark, theme-aware.
 *
 * Two-tone SVG:
 *   - "Clickefy" letters use the theme's ink color (black in light mode,
 *     white in dark mode) and stay legible against the app surface.
 *   - The ".Ai" portion is always the brand violet (#6E3CFF / theme accent),
 *     which doubles as our recurring accent dot motif.
 *
 * Paths sourced from `assets/branding/logo-black.svg` + `logo-white.svg`
 * — collapsed into one component so we don't ship two SVGs that differ only
 * by fill color. The aspect ratio is fixed at the artwork's viewBox.
 *
 * Usage:
 *   <Logo width={180} />              // theme-driven colors
 *   <Logo width={120} color="#FFF" /> // force-light (e.g. on dark gradient)
 */

import { useTheme } from '@clickfy/ui';
import Svg, { Path } from 'react-native-svg';

const VIEWBOX_W = 201.58;
const VIEWBOX_H = 38.62;
const ASPECT = VIEWBOX_W / VIEWBOX_H;

export interface LogoProps {
  /** Width in pt; height auto-derives from the artwork aspect ratio. */
  width?: number;
  /** Override the wordmark color. Defaults to `theme.colors.ink`. */
  color?: string;
  /** Override the ".Ai" color. Defaults to `theme.accent.solid`. */
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
      {/* "Clickefy" — letters use the theme ink color. */}
      <Path
        fill={wordmarkFill}
        d="M14.74.34c9.27,0,13.34,6.56,13.72,11.52h-5.72c-.38-2.92-2.84-6.44-7.92-6.44-5.76,0-9.06,4.53-9.06,10.16s3.3,10.16,9.06,10.16c5.08,0,7.54-3.51,7.92-6.44h5.72c-.38,4.95-4.45,11.52-13.72,11.52S0,24.01,0,15.58,5.33.34,14.74.34Z"
      />
      <Path fill={wordmarkFill} d="M37.27,30.49h-5.42V0h5.42v30.49Z" />
      <Path
        fill={wordmarkFill}
        d="M41.67,0h5.42v5.42h-5.42V0ZM47.09,8.13v22.36h-5.42V8.13h5.42Z"
      />
      <Path
        fill={wordmarkFill}
        d="M61.11,7.79c6.27,0,9.99,4.23,10.37,8.81h-5.34c-.34-2.12-1.99-3.9-5.04-3.9-3.73,0-5.89,2.71-5.89,6.61s2.16,6.61,5.89,6.61c3.05,0,4.7-1.78,5.04-3.9h5.34c-.38,4.57-4.07,8.81-10.37,8.81-6.82,0-11.31-4.87-11.31-11.52s4.36-11.52,11.31-11.52Z"
      />
      <Path
        fill={wordmarkFill}
        d="M95.2,30.49h-6.77l-6.86-9.36-1.95,1.95v7.41h-5.42V0h5.42v13.34c0,1.78-.42,2.5-1.1,3.34-.17.21-.25.51,0,.72.34.25.59,0,.72-.13l8.51-9.15h6.78l-9.32,9.36,9.99,13Z"
      />
      <Path
        fill={wordmarkFill}
        d="M116.08,20.66h-16.26c.38,3.39,2.58,5.42,5.97,5.42,2.58,0,3.9-1.4,4.53-3.39h5.5c-.97,4.62-4.11,8.13-10.08,8.13-7.24,0-11.22-4.87-11.22-11.52,0-6.99,4.32-11.52,11.14-11.52,5.17,0,10.54,3.09,10.54,11.22,0,.59-.04,1.02-.13,1.65ZM110.78,16.94c-.21-2.71-1.82-4.74-4.95-4.74-3.68,0-5.25,2.08-5.8,4.74h10.76Z"
      />
      <Path
        fill={wordmarkFill}
        d="M125.69,7.37v.76h6.1v4.74h-6.1v17.61h-5.42V12.87h-3.39v-4.74h3.39v-1.27c0-5.38,2.12-6.86,6.61-6.86h4.91v4.74h-3.77c-2.29,0-2.33.17-2.33,2.62Z"
      />
      <Path
        fill={wordmarkFill}
        d="M132.47,8.13h5.76l5,14.44c.3.89.34,1.69.34,2.54,0,.3.04.72.51.72s.51-.38.51-.72c0-.8.08-1.65.38-2.54l4.79-14.44h5.76l-9.49,24.94c-1.52,3.98-3.64,5.55-7.54,5.55h-4.06v-4.74h1.86c3.22,0,3.85,0,4.45-1.74l.47-1.35-8.72-22.65Z"
      />

      {/* ".Ai" — always the brand violet accent. */}
      <Path fill={accentFill} d="M156.86,24.39h6.1v6.1h-6.1v-6.1Z" />
      <Path
        fill={accentFill}
        d="M187.69,30.49l-2.29-6.77h-12.36l-2.29,6.77h-6.44L175.16.68h8.13l10.84,29.81h-6.44ZM174.61,18.97h9.23l-3.43-10.2c-.38-1.19-.64-2.75-.68-4.23,0-.25-.08-.59-.51-.59s-.51.34-.51.59c-.04,1.48-.3,3.05-.68,4.23l-3.43,10.2Z"
      />
      <Path
        fill={accentFill}
        d="M196.16,0h5.42v5.42h-5.42V0ZM201.58,8.13v22.36h-5.42V8.13h5.42Z"
      />
    </Svg>
  );
}

/** Convenience helper for layouts that need to reserve the right amount of space. */
export function getLogoHeight(width: number): number {
  return width / ASPECT;
}
