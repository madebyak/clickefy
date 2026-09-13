import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * Carries the tab title for the projects page, which is a client component
 * and so cannot export metadata itself.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "projects" });
  return { title: t("heading") };
}

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
