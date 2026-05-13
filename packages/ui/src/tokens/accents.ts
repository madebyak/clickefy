/**
 * Accent palettes — user-selectable brand tints.
 * Violet is the canonical Clickfy brand; the others let users personalize.
 */

export interface AccentPalette {
  /** Primary solid */
  solid: string;
  /** Light tint surface (chips, badges) */
  soft: string;
  /** Deep gradient stop */
  deep: string;
  /** Foreground color that reads on top of `solid` */
  ink: string;
  /** Glow shadow color, e.g. for buttons / banners */
  glow: string;
}

export const accents = {
  violet: {
    solid: '#6E3CFF',
    soft: '#EDE5FF',
    deep: '#3B1AAD',
    ink: '#FFFFFF',
    glow: 'rgba(110, 60, 255, 0.35)',
  },
  coral: {
    solid: '#FF5A3C',
    soft: '#FFE6DF',
    deep: '#C7361B',
    ink: '#FFFFFF',
    glow: 'rgba(255, 90, 60, 0.30)',
  },
  citrus: {
    solid: '#D8E83C',
    soft: '#F4F8C6',
    deep: '#7C8A0E',
    ink: '#0B0B12',
    glow: 'rgba(216, 232, 60, 0.45)',
  },
  ocean: {
    solid: '#2B7BFF',
    soft: '#E3EEFF',
    deep: '#0F4DC4',
    ink: '#FFFFFF',
    glow: 'rgba(43, 123, 255, 0.30)',
  },
} as const satisfies Record<string, AccentPalette>;

export type AccentKey = keyof typeof accents;
export const defaultAccent: AccentKey = 'violet';

/** Pro / paid plan badge color — independent of user accent. */
export const gold = {
  solid: '#F0B33A',
  soft: '#FFEFC8',
  ink: '#3D2A00',
} as const;
