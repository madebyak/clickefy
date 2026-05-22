/**
 * Save generated outputs to the user's photo library.
 *
 * ## Pipeline
 *
 *   1. **Resolve filename + extension** (`buildLocalFilename`). We never
 *      let Expo guess from the URL — bare streamId URLs (`/v1/outputs/<uuid>`)
 *      have no extension at all, and MediaLibrary refuses to save files
 *      without an extension on Android (MediaStore filters by mime) and
 *      iOS (Photos infers media type from `pathExtension` first).
 *   2. **Download to cache** via `File.downloadFileAsync(url, File, opts)`.
 *      Passing a *`File`* destination (with a chosen filename) is the
 *      explicit form recommended in the expo-file-system v19 docs; the
 *      `Directory` overload is the convenience path that derives names
 *      from the URL, which our endpoints can't guarantee.
 *   3. **Save to Photos / Gallery** via `MediaLibrary.saveToLibraryAsync`.
 *      Uses the write-only photo permission so an existing read-everything
 *      app doesn't get the broader scope as a side effect.
 *
 * ## Permissions
 *
 *   - iOS: `NSPhotoLibraryAddUsageDescription` (configured via the
 *     `expo-media-library` plugin in `app.json`, `savePhotosPermission`).
 *   - Android 13+: `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` runtime
 *     permission, added automatically by the plugin. Android 10–12 uses
 *     scoped MediaStore APIs and does not require broad storage access.
 *
 * ## Error reporting
 *
 * Every failure is funnelled into the `DownloadNotify.error` channel with
 * a *real* message in `detail` (not the generic "something went wrong"
 * placeholder). The same error is forwarded to Sentry with HTTP status,
 * mime type and URL tags so we can triage from the dashboard. The previous
 * implementation suppressed everything that didn't match keyword heuristics
 * (`permission` / `network` / `fetch`), which is why a 404 or a missing
 * extension surfaced as the same opaque "Could not save" message.
 *
 * ## Known limitations (kept honest, not silently swallowed)
 *
 *   - Cloudflare-Stream-backed videos: the API currently emits
 *     `/v1/outputs/<streamId>` URLs, but Stream IDs live in the
 *     Stream service, not R2 — the worker returns 404. We catch the
 *     404 and tell the user "Video saving isn't available yet" instead
 *     of pretending the network failed. Wiring real MP4 downloads is a
 *     backend follow-up (Stream → `/downloads/default.mp4`).
 *   - iOS has occasional MediaLibrary regressions for `.mov`/`.mp4`
 *     (Expo issue #33537 in SDK 52+). When the save call throws with a
 *     "type not supported" error we surface that verbatim.
 */

import * as Haptics from 'expo-haptics';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Alert } from 'react-native';
import * as Sentry from '@sentry/react-native';

import type { JobOutput } from '@clickfy/sdk';

/**
 * Tiny "report transient state to the user" surface. In practice the
 * caller wires `useToast()` here, but the module deliberately doesn't
 * import the toast hook so it stays a plain async lib (no React
 * dependency). When the caller forgets to pass `notify` we fall back
 * to silent — feedback is the caller's responsibility.
 */
export interface DownloadNotify {
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
  /** Optional warning slot for partial-success batches. */
  warning?: (message: string, detail?: string) => void;
  /** Optional non-toast inline progress hint, e.g. "Saving 1 of 3…". */
  info?: (message: string, detail?: string) => void;
}

type DownloadFailureReason =
  | 'permission'
  | 'network'
  | 'http_404'
  | 'http_4xx'
  | 'http_5xx'
  | 'unsupported_media'
  | 'unknown';

type DownloadResult =
  | { ok: true }
  | { ok: false; reason: DownloadFailureReason; detail: string };

const noop = () => {};
const defaultNotify: DownloadNotify = { success: noop, error: noop };

// ─── Permission ─────────────────────────────────────────────────────

/**
 * Prompt for photo-library *write* permission. Returns true if the
 * user granted or had already granted permission, false otherwise.
 * We use the write-only scope so an existing read-everything app
 * doesn't get the broader permission as a side effect.
 *
 * When `canAskAgain === false` the user has previously denied with
 * "Don't ask again" — iOS / Android both require the user to manually
 * re-enable in Settings. A blocking `Alert` is the right modal here
 * (this is a system decision that must be acknowledged), not a toast.
 */
async function ensurePermission(): Promise<boolean> {
  const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync(true);
  if (status === 'granted') return true;
  if (!canAskAgain) {
    Alert.alert(
      'Photo library access is off',
      'Open Settings → Clickefy → Photos and enable access so we can save your generations.',
    );
  }
  return false;
}

// ─── Filename + extension resolution ────────────────────────────────

const ALLOWED_IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'heic',
  'heif',
  'webp',
  'gif',
]);
const ALLOWED_VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v']);

/**
 * Build a guaranteed-valid local filename for the downloaded asset.
 *
 * Preference order:
 *   1. URL path extension when it's a media type we know.
 *   2. Sensible default per `kind` (jpg for images, mp4 for videos).
 *
 * The base is a timestamp + short random suffix so concurrent batch
 * downloads can't collide in the cache directory, even with
 * `idempotent: false`. The `clickfy-` prefix is purely for debugging —
 * `ls Paths.cache` in dev clearly shows "things we wrote".
 */
function buildLocalFilename(out: JobOutput): string {
  const urlExt = extractExtensionFromUrl(out.url);
  const allowed = out.kind === 'video' ? ALLOWED_VIDEO_EXTS : ALLOWED_IMAGE_EXTS;
  const fallback = out.kind === 'video' ? 'mp4' : 'jpg';
  const ext = urlExt && allowed.has(urlExt) ? urlExt : fallback;
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `clickfy-${stamp}.${ext}`;
}

function extractExtensionFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() ?? '';
    const dot = last.lastIndexOf('.');
    if (dot <= 0 || dot === last.length - 1) return undefined;
    const ext = last.slice(dot + 1).toLowerCase();
    // Reject obviously-bad matches (UUID fragments etc). Real media
    // extensions are short alphanumeric — anything longer than 5
    // chars or with weird chars is almost certainly noise.
    if (!/^[a-z0-9]{2,5}$/.test(ext)) return undefined;
    return ext;
  } catch {
    return undefined;
  }
}

// ─── Core download (single output) ──────────────────────────────────

async function downloadOne(out: JobOutput): Promise<DownloadResult> {
  const filename = buildLocalFilename(out);
  const destination = new File(Paths.cache, filename);

  // The static `downloadFileAsync` is declared to return `Promise<File>`
  // but the inner `File` refers to a structural shape in
  // `ExpoFileSystem.types.d.ts`, not the concrete `File` class we
  // imported. Inferring the type avoids a spurious TS2740 mismatch
  // between the two — the runtime object is the same either way and
  // we only consume `.uri` / `.size` below, both present on both.
  let downloaded: Awaited<ReturnType<typeof File.downloadFileAsync>>;
  try {
    // Pass a *File* destination (with chosen filename + extension)
    // instead of a Directory. This is the explicit form documented for
    // expo-file-system v19 and is required because:
    //   - some of our URLs (`/v1/outputs/<streamId>`) carry no extension
    //     at all; Expo's directory-overload would write a name-less
    //     file that MediaLibrary then refuses to ingest;
    //   - cross-batch filename collisions would otherwise overwrite
    //     earlier files mid-batch.
    downloaded = await File.downloadFileAsync(out.url, destination, {
      idempotent: true,
    });
  } catch (err) {
    return classifyDownloadError(err, out);
  }

  // Sanity-check we actually got bytes. `File#size` is a synchronous
  // getter that returns 0 if the file is missing OR unreadable, so a
  // single check covers both "wrote nothing" and "got cleaned up".
  // Some Android network conditions leave a 0-byte cache file without
  // throwing — bailing here gives a precise message instead of letting
  // MediaLibrary fail later with a vaguer one.
  if (downloaded.size === 0) {
    Sentry.captureMessage('[download] zero-byte file after downloadFileAsync', {
      level: 'warning',
      tags: { feature: 'download', kind: out.kind },
      contexts: { download: { url: out.url, filename } },
    });
    return {
      ok: false,
      reason: 'unknown',
      detail: 'Downloaded file is empty. Try again on a stronger network.',
    };
  }

  try {
    await MediaLibrary.saveToLibraryAsync(downloaded.uri);
    return { ok: true };
  } catch (err) {
    return classifySaveError(err, out, downloaded.uri);
  }
}

// ─── Error classification ───────────────────────────────────────────

function classifyDownloadError(err: unknown, out: JobOutput): DownloadResult {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  Sentry.captureException(err, {
    tags: { feature: 'download', op: 'fetch', kind: out.kind },
    contexts: { download: { url: out.url } },
    fingerprint: ['download-fetch-failed'],
  });

  // expo-file-system reports HTTP errors via messages like
  // `UnableToDownload: 404 Not Found` — pattern-match on the status.
  const statusMatch = /\b(\d{3})\b/.exec(message);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;

  if (status === 404) {
    // Distinguish the known broken Cloudflare-Stream video case from
    // a generic 404. If the URL contains no path extension at all we
    // assume it's a Stream UUID and explain the situation explicitly
    // instead of letting the user think the asset disappeared.
    const looksLikeStreamId =
      out.kind === 'video' && extractExtensionFromUrl(out.url) === undefined;
    return {
      ok: false,
      reason: 'http_404',
      detail: looksLikeStreamId
        ? "Saving videos isn't supported yet on this device — try downloading from the web for now."
        : 'The file is no longer available (404). Generate again and retry.',
    };
  }
  if (status && status >= 400 && status < 500) {
    return { ok: false, reason: 'http_4xx', detail: `Server rejected the download (${status}).` };
  }
  if (status && status >= 500) {
    return { ok: false, reason: 'http_5xx', detail: `Server error (${status}). Try again shortly.` };
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('connection')) {
    return { ok: false, reason: 'network', detail: 'Check your connection and try again.' };
  }
  if (lower.includes('permission')) {
    return { ok: false, reason: 'permission', detail: message };
  }
  return { ok: false, reason: 'unknown', detail: message };
}

function classifySaveError(err: unknown, out: JobOutput, fileUri: string): DownloadResult {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  Sentry.captureException(err, {
    tags: { feature: 'download', op: 'save', kind: out.kind },
    contexts: { download: { url: out.url, fileUri } },
    fingerprint: ['download-save-failed'],
  });

  if (
    lower.includes('not supported') ||
    lower.includes('unsupported') ||
    lower.includes('type is not')
  ) {
    return {
      ok: false,
      reason: 'unsupported_media',
      detail:
        out.kind === 'video'
          ? 'This video format can\u2019t be saved to your library on this device.'
          : 'This image format can\u2019t be saved to your library on this device.',
    };
  }
  if (lower.includes('permission') || lower.includes('denied')) {
    return { ok: false, reason: 'permission', detail: message };
  }
  return { ok: false, reason: 'unknown', detail: message };
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Save a single output. Pass a `notify` adapter (typically
 * `useToast()`) to surface success / failure as a toast. Permission
 * denials still use the blocking native Alert because they require a
 * user decision to leave the app and visit Settings.
 */
export async function downloadOutput(
  out: JobOutput,
  notify: DownloadNotify = defaultNotify,
): Promise<void> {
  if (!(await ensurePermission())) return;
  const result = await downloadOne(out);
  if (result.ok) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    notify.success(
      'Saved',
      out.kind === 'video' ? 'Video added to your library.' : 'Image added to your library.',
    );
  } else {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    notify.error("Couldn't save", result.detail);
  }
}

/**
 * Save every output in the array. Runs them in parallel — typical
 * batches are 4–8 files of <5MB each so the network can handle
 * concurrency comfortably. A partial-success result tells the user
 * exactly how many landed.
 */
export async function downloadOutputs(
  outs: JobOutput[],
  notify: DownloadNotify = defaultNotify,
): Promise<void> {
  if (outs.length === 0) return;
  if (!(await ensurePermission())) return;

  const results = await Promise.all(outs.map((o) => downloadOne(o)));
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;

  if (failed === 0) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    notify.success('Saved', `${ok} item${ok === 1 ? '' : 's'} added to your library.`);
    return;
  }

  // Pick the most informative single error message for the toast detail
  // — usually the first non-ok result is representative of the cohort
  // (same template => same backend behaviour).
  const firstFailure = results.find((r) => !r.ok) as
    | Extract<DownloadResult, { ok: false }>
    | undefined;
  const detail = firstFailure?.detail;

  if (ok === 0) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    notify.error(
      "Couldn't save",
      detail ?? 'None of the items could be saved. Check your connection and try again.',
    );
  } else {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    (notify.warning ?? notify.error)(
      'Partial save',
      `${ok} saved · ${failed} failed${detail ? ` — ${detail}` : ''}`,
    );
  }
}
