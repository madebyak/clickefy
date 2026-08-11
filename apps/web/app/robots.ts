import type { MetadataRoute } from "next";
import { config } from "@/lib/config";

/**
 * Robots policy. Defaults to NOINDEX-everything: the site is in its
 * private testing phase (vercel.app preview + unlisted subdomain) and
 * must not appear in search engines. At public launch, set
 * `NEXT_PUBLIC_ALLOW_INDEXING=1` in the production environment — no
 * code change needed.
 */
export default function robots(): MetadataRoute.Robots {
  const allow = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "1";
  return {
    rules: allow
      ? { userAgent: "*", allow: "/", disallow: ["/create", "/create-video", "/projects", "/settings"] }
      : { userAgent: "*", disallow: "/" },
    // Only advertise the sitemap once the site is indexable.
    sitemap: allow ? `${config.siteUrl}/sitemap.xml` : undefined,
    host: allow ? config.siteUrl : undefined,
  };
}
