import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { config } from "@/lib/config";
import { routing } from "@/i18n/routing";

/**
 * Auth-gated studio surfaces — nothing there is worth crawling. `/templates/`
 * (trailing slash) is the template RUN page; the public gallery at
 * `/templates` stays crawlable.
 */
const PRIVATE_PATHS = [
  "/create",
  "/create-video",
  "/projects",
  "/favorites",
  "/settings",
  "/billing",
  "/templates/",
  // Served on production for the team's reference, but unlisted — see
  // design-system/layout.tsx (noindex) and its absence from the sitemap.
  "/design-system",
] as const;

/**
 * Robots rules are prefix matches on the raw path, so "/create" does NOT
 * cover "/ar/create" — every private path needs its locale-prefixed twin.
 * English is unprefixed (`localePrefix: "as-needed"`).
 */
const disallow = routing.locales.flatMap((locale) => {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return PRIVATE_PATHS.map((path) => `${prefix}${path}`);
});

/** The one host search engines may index. */
const CANONICAL_HOST = new URL(config.siteUrl).hostname;

/**
 * Indexing is on — for the real domain only. The same deployment also
 * answers on its *.vercel.app addresses (and a preview URL, and localhost);
 * reading the request host tells crawlers to stay out of all of those, so
 * none of them competes with clickefy.ai in search. Reading the host makes
 * this route dynamic, which is the point.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(":")[0];

  if (host !== CANONICAL_HOST) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/", disallow },
    sitemap: `${config.siteUrl}/sitemap.xml`,
    host: config.siteUrl,
  };
}
