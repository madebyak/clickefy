import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  images: {
    // Whitelist the Worker origins that proxy R2 uploads. Without this,
    // `next/image` refuses any external host. We accept both the local
    // wrangler dev port and the deployed Worker subdomain so the same
    // admin code works in both environments.
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '8787' },
      { protocol: 'http', hostname: '127.0.0.1', port: '8787' },
      { protocol: 'https', hostname: '*.workers.dev' },
      { protocol: 'https', hostname: 'api.clickefy.ai' },
      { protocol: 'https', hostname: '*.clickefy.ai' },
    ],
  },
};

export default nextConfig;
