/**
 * Typography scale — 9 named variants, locale-aware font families.
 *
 * Latin families (default):
 *   - `sans`    : Geist (UI text)
 *   - `mono`    : Geist Mono (numbers, credits, code)
 *   - `display` : Instrument Serif (hero moments — paywall, results reveal)
 *
 * Arabic families (active when the app locale is `ar`):
 *   - `sans`    : IBM Plex Sans Arabic (pairs with Geist; same weight ramp)
 *   - `mono`    : Geist Mono (digits are Western; no Arabic mono needed)
 *   - `display` : IBM Plex Sans Arabic Bold (Arabic has no serif equivalent,
 *                 so headlines reuse the bold sans — a clean, consistent look)
 *
 * Latin and Arabic share the SAME variant keys and metrics, so swapping the
 * active set never changes layout sizing. Two Arabic-specific adjustments:
 *   - letterSpacing is forced to 0 (Arabic is a connected script; negative
 *     tracking that tightens Latin would visually break Arabic joins).
 *   - lineHeight is scaled up slightly to give diacritics breathing room.
 *
 * The active set is selected in `ThemeProvider` from the resolved locale and
 * exposed via `useTheme().typography` / `useTheme().fontFamily`, so every
 * component that renders through the `Text` primitive is covered for free.
 */

import type { TextStyle } from 'react-native';

/** Latin font family map (Geist + Instrument Serif). */
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

/**
 * Arabic font family map. Same keys as `fontFamily` so it's a drop-in
 * replacement. Mono keeps Geist Mono (numerals); display + italic reuse the
 * bold Arabic sans since there is no Arabic serif counterpart.
 */
export const arabicFontFamily = {
  sans: 'IBMPlexSansArabic_400Regular',
  sansMedium: 'IBMPlexSansArabic_500Medium',
  sansSemibold: 'IBMPlexSansArabic_600SemiBold',
  sansBold: 'IBMPlexSansArabic_700Bold',
  mono: 'GeistMono_500Medium',
  monoSemibold: 'GeistMono_600SemiBold',
  monoBold: 'GeistMono_700Bold',
  display: 'IBMPlexSansArabic_700Bold',
  displayItalic: 'IBMPlexSansArabic_700Bold',
} as const satisfies Record<FontFamilyKey, string>;

export interface TypographyVariant {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  fontWeight?: TextStyle['fontWeight'];
}

export type TypographyVariantKey =
  | 'display'
  | 'title'
  | 'heading'
  | 'subhead'
  | 'body'
  | 'bodySemi'
  | 'caption'
  | 'overline'
  | 'mono';

type TypographyMap = Record<TypographyVariantKey, TypographyVariant>;

/**
 * Build the variant map for a given font family set. When `arabic` is true,
 * letterSpacing is zeroed and lineHeight is scaled up for Arabic legibility;
 * otherwise the exact original Latin metrics are preserved.
 */
function makeTypography(ff: Record<FontFamilyKey, string>, arabic = false): TypographyMap {
  const lh = (value: number) => (arabic ? Math.round(value * 1.18) : value);
  const ls = (value: number) => (arabic ? 0 : value);
  return {
    /** 44/48 — paywall hero, splash. Use sparingly. */
    display: { fontFamily: ff.display, fontSize: 44, lineHeight: lh(48), letterSpacing: ls(-1.4) },
    /** 32/38 — major screen titles (e.g. category name) */
    title: { fontFamily: ff.sansBold, fontSize: 32, lineHeight: lh(38), letterSpacing: ls(-1.0) },
    /** 22/28 — section headers ("Trending now") */
    heading: { fontFamily: ff.sansBold, fontSize: 22, lineHeight: lh(28), letterSpacing: ls(-0.6) },
    /** 17/22 — card titles, subheaders */
    subhead: { fontFamily: ff.sansSemibold, fontSize: 17, lineHeight: lh(22), letterSpacing: ls(-0.3) },
    /** 15/22 — paragraph */
    body: { fontFamily: ff.sans, fontSize: 15, lineHeight: lh(22), letterSpacing: ls(-0.1) },
    /** 15/22 — emphasized body / button labels */
    bodySemi: { fontFamily: ff.sansSemibold, fontSize: 15, lineHeight: lh(22), letterSpacing: ls(-0.1) },
    /** 13/18 — meta, helper text */
    caption: { fontFamily: ff.sans, fontSize: 13, lineHeight: lh(18), letterSpacing: ls(0) },
    /** 11/14 uppercase — labels ("FEATURED TEMPLATES") */
    overline: { fontFamily: ff.sansSemibold, fontSize: 11, lineHeight: lh(14), letterSpacing: ls(0.6) },
    /** Mono helper for credits / numbers */
    mono: { fontFamily: ff.monoSemibold, fontSize: 14, lineHeight: lh(18), letterSpacing: ls(-0.2) },
  };
}

/** Latin (default) typography variants. */
export const typography: TypographyMap = makeTypography(fontFamily);

/** Arabic typography variants — zeroed tracking, taller lines. */
export const arabicTypography: TypographyMap = makeTypography(arabicFontFamily, true);
