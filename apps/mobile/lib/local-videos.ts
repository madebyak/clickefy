/**
 * Local video asset registry.
 *
 * Resolves the symbolic keys (e.g. `local:spin`) used in mock template
 * data to actual bundled video assets via `require()`. This indirection
 * lets `@clickfy/sdk` (a non-RN package) stay platform-agnostic — only
 * the mobile app reaches for Metro's asset system.
 *
 * Add a new entry here whenever you drop a clip into `assets/images/`
 * (or, better, `assets/videos/` once we move the folder).
 *
 * For remote previews (the eventual production state), `previewVideo`
 * will hold a full `https://…` URL and `resolveLocalVideo` will pass it
 * through untouched.
 */

import type { VideoSource } from 'expo-video';

const LOCAL_VIDEO_MAP: Record<string, number> = {
  // Source: /apps/mobile/assets/images/
  spin: require('../assets/images/1778595742950-e965cfd4-5a04-42bb-a372-7606ac45bfb9.mp4'),
  cream: require('../assets/images/1778596022500-320f7a16-6de5-4a97-867e-fb04b95eab21.mp4'),
};

/**
 * Resolve a `previewVideo` string into a `VideoSource` `expo-video` can
 * consume. Returns `null` when the input is unknown so callers fall
 * back to the static cover image.
 */
export function resolveLocalVideo(value: string | undefined | null): VideoSource | null {
  if (!value) return null;

  // Symbolic local key — `local:<id>`
  if (value.startsWith('local:')) {
    const key = value.slice('local:'.length);
    const asset = LOCAL_VIDEO_MAP[key];
    return asset !== undefined ? asset : null;
  }

  // Remote URL — pass through.
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return { uri: value };
  }

  return null;
}
