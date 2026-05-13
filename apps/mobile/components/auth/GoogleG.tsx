/**
 * Google "G" mark — official 4-color brand artwork.
 *
 * Vector paths reproduced from Google's public brand guidelines (the same
 * artwork used by `@react-native-google-signin/google-signin`'s
 * `GoogleSigninButton`). Inlining the SVG via `react-native-svg` keeps us
 * compatible with Expo Go — once we move to a dev build for real OAuth we
 * can swap this for the official native button.
 *
 * TODO(REAL-OAUTH): when we ship `@react-native-google-signin/google-signin`,
 *   replace this component with `<GoogleSigninButton size={...} />`. Pre-built
 *   button gives us the press-state ripples + a11y label for free, but it
 *   requires a custom dev client (won't run in Expo Go).
 */

import Svg, { Path } from 'react-native-svg';

interface GoogleGProps {
  size?: number;
}

export function GoogleG({ size = 18 }: GoogleGProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.61z"
        fill="#4285F4"
      />
      <Path
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.92v2.32A9 9 0 0 0 9 18z"
        fill="#34A853"
      />
      <Path
        d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.92a9 9 0 0 0 0 8.07l3.05-2.32z"
        fill="#FBBC05"
      />
      <Path
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .92 4.96l3.05 2.32C4.68 5.18 6.66 3.58 9 3.58z"
        fill="#EA4335"
      />
    </Svg>
  );
}
