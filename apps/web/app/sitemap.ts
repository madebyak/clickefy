import type { MetadataRoute } from "next";
import { config } from "@/lib/config";
import { routing } from "@/i18n/routing";
import { BLOG_POSTS } from "@/lib/blog/posts";

/**
 * Sitemap for the PUBLIC surface only — marketing pages, the template
 * gallery and the blog. Studio routes (create, projects, settings) are auth-gated and
 * disallowed in robots.ts, so they're intentionally omitted. Each path is
 * emitted per-locale with hreflang alternates (English unprefixed,
 * Arabic under /ar, matching `localePrefix: "as-needed"`).
 */
const PUBLIC_PATHS = [
  "",
  "/templates",
  "/pricing",
  "/models",
  "/about",
  "/contact",
  "/blog",
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

function entry(path: string, lastModified: Date, priority: number): MetadataRoute.Sitemap[number] {
  return {
    url: localizedUrl(path, routing.defaultLocale),
    lastModified,
    changeFrequency: "weekly",
    priority,
    alternates: {
      languages: {
        ...Object.fromEntries(routing.locales.map((locale) => [locale, localizedUrl(path, locale)])),
        "x-default": localizedUrl(path, routing.defaultLocale),
      },
    },
  };
}

export default function sitemap(): MetadataRoute.Sitemap {
  // Pages change with deploys, so they carry the build time. A post carries
  // its own date: lastModified is the freshness signal crawlers actually
  // use, and stamping every article "changed today" on each deploy teaches
  // them to ignore it.
  const built = new Date();
  return [
    ...PUBLIC_PATHS.map((path) => entry(path, built, path === "" ? 1 : 0.8)),
    ...BLOG_POSTS.map((post) => entry(`/blog/${post.slug}`, new Date(`${post.date}T00:00:00Z`), 0.7)),
  ];
}
