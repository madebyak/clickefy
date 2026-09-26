/**
 * Onboarding slide imagery — static asset mapping.
 *
 * Metro requires literal `require()` paths for assets, so this module
 * encodes the slide→image mapping as static imports. Swap any image by
 * dropping a new file with the same name into `apps/mobile/assets/onboarding/`
 * — no code changes needed.
 *
 * Naming convention:
 *   slide-{n}-{role}.{ext}   e.g. `slide-1-center.png`, `slide-3-back.jpg`
 *
 * Unused source media (screen recordings, an uncompressed 6.4 MB still) is
 * kept out of the app, in the local, untracked
 * `docs/design-refs/mobile-onboarding-source/`. Compress a file before
 * giving it one of the slots below.
 */

import type { ImageSourcePropType } from 'react-native';

/** Slide 1 — Orbit layout: 1 center hero + 2 tilted satellites. */
export const slide1Images: {
  center: ImageSourcePropType;
  left: ImageSourcePropType;
  right: ImageSourcePropType;
} = {
  center: require('../../assets/onboarding/slide-1-center.png'),
  left: require('../../assets/onboarding/slide-1-left.png'),
  right: require('../../assets/onboarding/slide-1-right.png'),
};

/** Slide 2 — Bento grid: 1 wide hero + 4 thumbnails. */
export const slide2Images: {
  hero: ImageSourcePropType;
  thumbs: [ImageSourcePropType, ImageSourcePropType, ImageSourcePropType, ImageSourcePropType];
} = {
  hero: require('../../assets/onboarding/slide-2-hero.png'),
  thumbs: [
    require('../../assets/onboarding/slide-2-a.png'),
    require('../../assets/onboarding/slide-2-b.jpg'),
    require('../../assets/onboarding/slide-2-c.jpg'),
    require('../../assets/onboarding/slide-2-d.jpg'),
  ],
};

/** Slide 3 — Stack: 3 fanning cards (front gets the play badge). */
export const slide3Images: {
  front: ImageSourcePropType;
  middle: ImageSourcePropType;
  back: ImageSourcePropType;
} = {
  front: require('../../assets/onboarding/slide-3-front.jpg'),
  middle: require('../../assets/onboarding/slide-3-middle.jpg'),
  back: require('../../assets/onboarding/slide-3-back.jpg'),
};
