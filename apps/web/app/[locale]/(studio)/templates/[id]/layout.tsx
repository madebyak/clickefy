import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * Carries the tab title for the template run page, which is a client
 * component and so cannot export metadata itself. The section name rather
 * than the template's own: naming it would mean a server fetch per render
 * for a page that is signed-in only and never shared.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "templates" });
  return { title: t("heading") };
}

export default function TemplateRunLayout({ children }: { children: React.ReactNode }) {
  return children;
}
