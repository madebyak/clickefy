/**
 * Motion tokens — durations + easing curves.
 * Keep interactions snappy (<250ms) per iOS HIG.
 */

import { Easing } from 'react-native';

export const duration = {
  instant: 80,
  fast: 160,
  base: 220,
  slow: 320,
  slower: 480,
} as const;

export const easing = {
  /** iOS standard ease-out — feels native for UI motion */
  standard: Easing.out(Easing.cubic),
  /** Spring-y entry for sheets & modals */
  emphasized: Easing.bezier(0.2, 0.8, 0.2, 1),
  /** Linear — only for progress bars */
  linear: Easing.linear,
} as const;

/** Default reanimated spring config for press / scale effects */
export const spring = {
  damping: 18,
  stiffness: 240,
  mass: 0.7,
} as const;
