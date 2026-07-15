import type { NextConfig } from "next";

// Deployed to Vercel from the feat/web branch (root: apps/web).
const nextConfig: NextConfig = {
  // Front-end only for now. Integration-time config (image remotePatterns for
  // the R2/Worker origins, server action limits, etc.) will be added when the
  // studio app starts talking to the API — mirror apps/admin/next.config.ts then.
};

export default nextConfig;
