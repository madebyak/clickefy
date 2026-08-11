import { config } from "@/lib/config";

/**
 * The API mints media URLs from its request origin — but under
 * `wrangler dev` the Worker sees the production route host
 * (api.clickefy.ai) even though it serves on localhost, so local URLs
 * point at prod and 404. Rebase any own-API host onto the origin this
 * app is configured to call. In production both match → no-op.
 */
const OWN_API_HOSTS = ["api.clickefy.ai"];

export function rebaseAssetUrl(url: string): string {
  try {
    const u = new URL(url);
    const api = new URL(config.apiUrl);
    if (
      u.origin !== api.origin &&
      (OWN_API_HOSTS.includes(u.hostname) || u.hostname.endsWith(".workers.dev"))
    ) {
      return `${api.origin}${u.pathname}${u.search}`;
    }
  } catch {
    // Not an absolute URL — leave untouched.
  }
  return url;
}
