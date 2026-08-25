/**
 * Save an asset to disk.
 *
 * WHY THIS IS NOT JUST `<a download>`
 *   The `download` attribute is IGNORED when the href is cross-origin —
 *   that is the spec, not a browser quirk. Our media is served from
 *   api.clickefy.ai while the app runs on app.clickefy.ai, so every
 *   download button in the studio degraded into a plain navigation and
 *   opened the image instead of saving it. Three copies of the same
 *   four-line helper each did it the same wrong way.
 *
 *   The fix is on the server: `?download=1` makes the asset route answer
 *   with `Content-Disposition: attachment`, which browsers DO honour
 *   across origins. The click below then streams straight to disk with no
 *   tab, no navigation, and no copy of the file in memory — which matters
 *   the moment someone downloads a 200MB video.
 *
 * FILENAMES
 *   The raw R2 key ends in things like `stage1-0.png`, which tells nobody
 *   anything once it is sitting in ~/Downloads next to forty others. We
 *   send a readable name and the server sanitises it before it reaches a
 *   header.
 */

/** Extension from a URL path, without the query string. Defaults sanely. */
function extensionOf(url: string, kind: "image" | "video"): string {
  const path = url.split("?")[0] ?? "";
  const match = /\.([a-z0-9]{1,5})$/i.exec(path);
  return match?.[1]?.toLowerCase() ?? (kind === "video" ? "mp4" : "png");
}

/**
 * A name someone can find again: the project when we know it, then a
 * short id to keep a batch from colliding.
 */
export function assetFilename(input: {
  id: string;
  src: string;
  type: "image" | "video";
  projectName?: string;
}): string {
  const stem = (input.projectName ?? "clickefy")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${stem || "clickefy"}-${input.id.slice(0, 8)}.${extensionOf(input.src, input.type)}`;
}

/**
 * Trigger the save.
 *
 * Same-origin and blob/data URLs skip the query parameters — they honour
 * `download` on their own, and appending to a `data:` URL would corrupt
 * it.
 */
export function downloadAsset(input: {
  id: string;
  src: string;
  type: "image" | "video";
  projectName?: string;
}): void {
  const filename = assetFilename(input);
  let href = input.src;

  if (/^https?:/i.test(input.src)) {
    try {
      const url = new URL(input.src, window.location.href);
      if (url.origin !== window.location.origin) {
        url.searchParams.set("download", "1");
        url.searchParams.set("name", filename);
      }
      href = url.toString();
    } catch {
      // Not parseable — fall through with the original and let the
      // `download` attribute do whatever it can.
    }
  }

  const el = document.createElement("a");
  el.href = href;
  el.download = filename;
  // Keep it out of the layout; some browsers require the node to be in
  // the document for a synthetic click to count as user-initiated.
  el.style.display = "none";
  document.body.appendChild(el);
  el.click();
  el.remove();
}

/**
 * Save several at once.
 *
 * Staggered on purpose: browsers treat a burst of synthetic clicks as a
 * popup storm and silently drop all but the first. 250ms is the interval
 * the studio has always used and no one has reported a miss.
 */
export function downloadAssets(
  assets: Array<{ id: string; src: string; type: "image" | "video"; projectName?: string }>,
): void {
  assets.forEach((asset, i) => {
    window.setTimeout(() => downloadAsset(asset), i * 250);
  });
}
