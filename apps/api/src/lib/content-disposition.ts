/**
 * `Content-Disposition: attachment` — the only reliable way to download a
 * cross-origin file.
 *
 * WHY THE SERVER HAS TO SAY IT
 *   The HTML spec has browsers IGNORE an <a download> attribute when the
 *   href is cross-origin. Our media is served from api.clickefy.ai and the
 *   app runs on app.clickefy.ai, so every "download" in the studio was
 *   silently downgraded to a plain navigation — the browser opened the
 *   image instead of saving it. The one documented exception is a response
 *   that asks to be an attachment, which is what this builds.
 *
 *   The alternative — fetch the bytes, make a Blob, download the object
 *   URL — needs no server change. It also pulls the whole file into memory
 *   before the save dialog appears, which is fine for a 400KB image and
 *   hostile for a 200MB video. Letting the browser stream straight to disk
 *   is simpler, and is the industry norm: it is what an S3
 *   `response-content-disposition` presign does.
 *
 * ON SANITISING
 *   The filename arrives as a query parameter, so it is untrusted input on
 *   its way into a response HEADER. A newline in it would let a caller
 *   append headers of their own. Everything below exists to make that
 *   impossible rather than unlikely: control characters and separators are
 *   stripped, not escaped.
 *
 * RFC 6266 / RFC 5987
 *   `filename=` carries an ASCII-safe form every client understands, and
 *   `filename*=UTF-8''...` carries the real name for those that support
 *   it. Sending both is the standard belt-and-braces — an old client takes
 *   the first, a modern one prefers the second.
 */

/** Longest filename we will echo. Comfortably under every FS limit. */
const MAX_NAME_LENGTH = 120;

/** Control characters, including CR/LF — the header-injection vector. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Anything outside printable ASCII, for the legacy `filename=` form. */
const NON_ASCII = /[^\u0020-\u007e]/g;

/**
 * Reduce an arbitrary string to something safe in a header and on a
 * filesystem. Returns null when nothing usable survives.
 */
function sanitise(raw: string): string | null {
  const cleaned = raw
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    // Path separators would let a name escape the download directory.
    .replace(/[/\\]/g, '-')
    // Reserved on Windows; `"` would also close the quoted-string early.
    .replace(/["<>:|?*]/g, '')
    .trim()
    // A leading dot hides the file on unix; a trailing dot or space is
    // silently dropped by Windows, changing the name behind the user's
    // back.
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, MAX_NAME_LENGTH);

  return cleaned.length > 0 ? cleaned : null;
}

/** ASCII fallback for the legacy `filename=` parameter. */
function asciiFallback(name: string): string {
  const ascii = name.replace(NON_ASCII, '_').trim();
  return ascii.length > 0 ? ascii : 'download';
}

/**
 * Build the header value.
 *
 * @param requested the caller's preferred name (untrusted, optional)
 * @param key       the R2 key, whose basename is the fallback
 */
export function attachmentDisposition(requested: string | undefined, key: string): string {
  const fromKey = sanitise(key.split('/').pop() ?? '');
  const name = (requested ? sanitise(requested) : null) ?? fromKey ?? 'download';
  const ascii = asciiFallback(name);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Did this request ask to download rather than view inline? */
export function wantsDownload(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}
