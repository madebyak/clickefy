import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * Carries the tab title for the favorites page, which is a client component
 * and so cannot export metadata itself.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "studio" });
  return { title: t("filterFavorites") };
}

export default function FavoritesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
