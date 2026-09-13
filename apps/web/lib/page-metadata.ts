import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

/**
 * The share card, as a plain public file rather than the `opengraph-image`
 * file convention. Next merges metadata SHALLOWLY: a convention image is
 * attached to the segment it sits in, and any page below that sets its own
 * `openGraph` — every page here does, for its og:url — replaces the whole
 * object and loses the image. One stable URL, referenced from the layout and
 * the pages alike, keeps it on every card. Regenerate with `pnpm gen:og`.
 */
export const SHARE_IMAGE = {
  url: "/og/default.png",
  width: 1200,
  height: 630,
  alt: "Clickefy — AI Creator Studio",
};

/**
 * The Open Graph fields every page shares. A page-level `openGraph` replaces
 * the layout's entirely, so pages spread this into theirs — without it,
 * og:site_name, og:type, og:locale and the image all vanish from the card.
 */
export function sharedOpenGraph(locale: string) {
  return {
    siteName: "Clickefy",
    type: "website" as const,
    locale: locale === "ar" ? "ar_AR" : "en_US",
    images: [SHARE_IMAGE],
  };
}

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
    openGraph: { ...sharedOpenGraph(locale), url: canonical },
  };
}
