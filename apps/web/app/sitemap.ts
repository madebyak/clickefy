import type { MetadataRoute } from "next";
import { config } from "@/lib/config";
import { routing } from "@/i18n/routing";

/**
 * Sitemap for the PUBLIC surface only — marketing home and the template
 * gallery. Studio routes (create, projects, settings) are auth-gated and
 * disallowed in robots.ts, so they're intentionally omitted. Each path is
 * emitted per-locale with hreflang alternates (English unprefixed,
 * Arabic under /ar, matching `localePrefix: "as-needed"`).
 */
const PUBLIC_PATHS = [
  "",
  "/templates",
  "/privacy",
  "/terms",
  "/account-deletion",
  "/content-policy",
  "/ai-disclosure",
  "/dmca",
] as const;

function localizedUrl(path: string, locale: string): string {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return `${config.siteUrl}${prefix}${path}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  // Build/regeneration time — the marketing pages change with deploys,
  // and lastModified is the one freshness signal crawlers actually use.
  const lastModified = new Date();
  return PUBLIC_PATHS.map((path) => ({
    url: localizedUrl(path, routing.defaultLocale),
    lastModified,
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.8,
    alternates: {
      languages: {
        ...Object.fromEntries(
          routing.locales.map((locale) => [locale, localizedUrl(path, locale)]),
        ),
        "x-default": localizedUrl(path, routing.defaultLocale),
      },
    },
  }));
}
