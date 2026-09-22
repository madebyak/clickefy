/**
 * Mode colors — the composer's orientation system, mirroring the web:
 * GREEN means image, PURPLE means video, everywhere the mode shows up
 * (mode pill, selected sheet options, Generate button, shimmer).
 *
 * Deliberately HARDCODED, not read from the theme accent: the user may
 * personalize the app accent (violet/coral/…), but these two are
 * wayfinding — "which mode am I in?" must survive any theme. Values
 * match the web's --brand-green / --brand-purple.
 */

import type { ComposerMode } from './sheets';

export interface ModeTint {
  /** Solid fill. */
  solid: string;
  /** Foreground that reads on `solid` (green needs dark, purple white). */
  fg: string;
}

export const MODE_TINT: Record<ComposerMode, ModeTint> = {
  image: { solid: '#42d676', fg: '#04150C' },
  video: { solid: '#6303e0', fg: '#FFFFFF' },
};
