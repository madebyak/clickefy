import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// Deployed to Vercel from the feat/web branch (root: apps/web).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Clickjacking: nothing on this site is meant to be framed.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // We use none of these sensors; deny by default.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Every *.vercel.app address serves the same pages as clickefy.ai.
        // robots.txt already closes those hosts to crawlers; this also keeps
        // any page there that is reached by a link out of the index, so only
        // the real domain ever shows up in search.
        source: "/(.*)",
        has: [{ type: "host", value: ".*\\.vercel\\.app" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
  images: {
    // Whitelist the Worker origins that serve R2 assets (uploads, outputs,
    // avatars). Mirrors apps/admin/next.config.ts: local wrangler dev plus
    // the deployed Worker domains.
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "8787" },
      { protocol: "http", hostname: "127.0.0.1", port: "8787" },
      { protocol: "https", hostname: "*.workers.dev" },
      { protocol: "https", hostname: "api.clickefy.ai" },
      { protocol: "https", hostname: "*.clickefy.ai" },
    ],
  },
};

export default withNextIntl(nextConfig);
