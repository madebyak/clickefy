import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * The living style guide ships on production as the team's brand
 * reference, but it is not a public page: robots.ts disallows the path,
 * the sitemap never lists it, and this metadata tells any crawler that
 * still lands here not to index it. (The page itself is a client
 * component, so the metadata lives on the route's layout.)
 */
export const metadata: Metadata = {
  title: "Design System",
  robots: { index: false, follow: false },
};

export default function DesignSystemLayout({ children }: { children: ReactNode }) {
  return children;
}
