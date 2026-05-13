/**
 * Save generated outputs to the user's photo library.
 *
 * Strategy: download the asset to `Paths.cache` via
 * `File.downloadFileAsync()` (which streams full-resolution bytes
 * straight off the server — no resize, no recompression), then hand
 * the local file URI to `MediaLibrary.saveToLibraryAsync()`. The
 * cached file is left in place; the OS reclaims it under storage
 * pressure.
 *
 * Permissions: iOS requires `NSPhotoLibraryAddUsageDescription` in
 * `Info.plist` — supplied by the expo-media-library plugin
 * configured in `app.json`. Android 13+ requires the
 * `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` runtime permission, which
 * the plugin also adds automatically.
 */

import * as Haptics from 'expo-haptics';
import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Alert } from 'react-native';

import type { JobOutput } from '@clickfy/sdk';

/**
 * Result of a download — used internally for batch reporting. Not
 * surfaced to callers individually because the per-file outcome
 * usually doesn't matter; the user wants the batch result.
 */
type DownloadResult =
  | { ok: true }
  | { ok: false; reason: 'permission' | 'network' | 'unknown' };

/**
 * Prompt for photo-library *write* permission. Returns true if the
 * user granted or had already granted permission, false otherwise.
 * We use the write-only scope so an existing read-everything app
 * doesn't get the broader permission as a side effect.
 */
async function ensurePermission(): Promise<boolean> {
  const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync(true);
  if (status === 'granted') return true;
  if (!canAskAgain) {
    Alert.alert(
      'Photo library access denied',
      'Open Settings → Clickefy → Photos and enable access so we can save your generations.',
    );
  }
  return false;
}

async function downloadOne(out: JobOutput): Promise<DownloadResult> {
  try {
    // `Paths.cache` is reclaimed automatically by the OS; we don't
    // bother cleaning up explicitly. `idempotent: true` overwrites
    // on a same-filename collision (rare — URLs include r2Key).
    const local = await File.downloadFileAsync(
      out.url,
      new Directory(Paths.cache),
      { idempotent: true },
    );
    // `downloadFileAsync` resolves with the `File` instance; the
    // local URI is on `.uri` and is what `saveToLibraryAsync`
    // expects.
    await MediaLibrary.saveToLibraryAsync(local.uri);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('permission')) {
      return { ok: false, reason: 'permission' };
    }
    if (msg.toLowerCase().includes('network') || msg.includes('fetch')) {
      return { ok: false, reason: 'network' };
    }
    return { ok: false, reason: 'unknown' };
  }
}

/**
 * Save a single output. Reports success / failure via an Alert so
 * the caller can be fire-and-forget.
 */
export async function downloadOutput(out: JobOutput): Promise<void> {
  if (!(await ensurePermission())) return;
  const result = await downloadOne(out);
  if (result.ok) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      'Saved',
      out.kind === 'video' ? 'Video saved to your library.' : 'Image saved to your library.',
    );
  } else {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Alert.alert(
      'Could not save',
      result.reason === 'network'
        ? 'Check your connection and try again.'
        : 'Something went wrong while saving. Please try again.',
    );
  }
}

/**
 * Save every output in the array. Runs them in parallel — typical
 * batches are 4–8 files of <5MB each so the network can handle
 * concurrency comfortably. A partial-success result tells the user
 * exactly how many landed.
 */
export async function downloadOutputs(outs: JobOutput[]): Promise<void> {
  if (outs.length === 0) return;
  if (!(await ensurePermission())) return;

  const results = await Promise.all(outs.map(downloadOne));
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;

  if (failed === 0) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Saved', `${ok} item${ok === 1 ? '' : 's'} saved to your library.`);
  } else if (ok === 0) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Alert.alert(
      'Could not save',
      'None of the items could be saved. Check your connection and try again.',
    );
  } else {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Partial save',
      `${ok} saved · ${failed} failed. Try again to retry the failures.`,
    );
  }
}
