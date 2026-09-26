/**
 * Template preview clips.
 *
 * `previewVideo` on a catalog template is a remote URL; this turns it
 * into a `VideoSource` for `expo-video`, or `null` so callers fall back
 * to the static cover image. (It once also resolved `local:<key>` names
 * to clips bundled with the app — the mock-catalog era. Nothing produces
 * those any more, and the bundled clips were ~15 MB of dead weight.)
 */

import type { VideoSource } from 'expo-video';

export function resolvePreviewVideo(value: string | undefined | null): VideoSource | null {
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return { uri: value };
  }
  return null;
}
