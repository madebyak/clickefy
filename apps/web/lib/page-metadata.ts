import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

/**
 * Per-page canonical + hreflang alternates + og:url for the PUBLIC
 * pages that should rank. Layout metadata deliberately omits these
 * (shallow merge would make every page inherit the homepage's
 * canonical), so each indexable page composes its own from its path.
 *
 * `path` is the locale-less route ("" for home, "/templates", …).
 * URLs are relative — Next resolves them against the layout's
 * `metadataBase`. English is unprefixed, Arabic under /ar (matching
 * `localePrefix: "as-needed"`); x-default points at English.
 */
export function localizedPageMetadata(locale: string, path: "" | `/${string}`): Metadata {
  const forLocale = (loc: string) =>
    loc === routing.defaultLocale ? path || "/" : `/${loc}${path}`;
  const canonical = forLocale(locale);
  return {
    alternates: {
      canonical,
      languages: {
        ...Object.fromEntries(routing.locales.map((loc) => [loc, forLocale(loc)])),
        "x-default": forLocale(routing.defaultLocale),
      },
    },
    openGraph: { url: canonical },
  };
}
