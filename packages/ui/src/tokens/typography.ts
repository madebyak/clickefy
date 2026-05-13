/**
 * Typography scale — 8 named variants, three font families.
 *
 * Families:
 *   - `sans`    : Geist (UI text, default)
 *   - `mono`    : Geist Mono (numbers, credits, code)
 *   - `display` : Instrument Serif (hero moments — paywall, results reveal)
 *
 * Variants encode size, lineHeight, weight, and letterSpacing — pulled from
 * the prototype where dense values were spread across primitives.
 */

import type { TextStyle } from 'react-native';

export const fontFamily = {
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  sansSemibold: 'Geist_600SemiBold',
  sansBold: 'Geist_700Bold',
  mono: 'GeistMono_500Medium',
  monoSemibold: 'GeistMono_600SemiBold',
  monoBold: 'GeistMono_700Bold',
  display: 'InstrumentSerif_400Regular',
  displayItalic: 'InstrumentSerif_400Regular_Italic',
} as const;

export type FontFamilyKey = keyof typeof fontFamily;

export interface TypographyVariant {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  fontWeight?: TextStyle['fontWeight'];
}

export const typography = {
  /** 44/48 — paywall hero, splash. Use sparingly. */
  display: {
    fontFamily: fontFamily.display,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1.4,
  },
  /** 32/38 — major screen titles (e.g. category name) */
  title: {
    fontFamily: fontFamily.sansBold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -1.0,
  },
  /** 22/28 — section headers ("Trending now") */
  heading: {
    fontFamily: fontFamily.sansBold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.6,
  },
  /** 17/22 — card titles, subheaders */
  subhead: {
    fontFamily: fontFamily.sansSemibold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
  },
  /** 15/22 — paragraph */
  body: {
    fontFamily: fontFamily.sans,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  /** 15/22 — emphasized body / button labels */
  bodySemi: {
    fontFamily: fontFamily.sansSemibold,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  /** 13/18 — meta, helper text */
  caption: {
    fontFamily: fontFamily.sans,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
  },
  /** 11/14 uppercase — labels ("FEATURED TEMPLATES") */
  overline: {
    fontFamily: fontFamily.sansSemibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.6,
  },
  /** Mono helper for credits / numbers */
  mono: {
    fontFamily: fontFamily.monoSemibold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: -0.2,
  },
} as const satisfies Record<string, TypographyVariant>;

export type TypographyVariantKey = keyof typeof typography;
