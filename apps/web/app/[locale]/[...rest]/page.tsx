import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

/**
 * `not-found.tsx` cannot export metadata, so the route that renders it
 * names the tab — otherwise a 404 wears the homepage's title.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "errors" });
  return { title: t("notFoundTitle"), robots: { index: false, follow: true } };
}

/**
 * Catch-all for unmatched paths under a valid locale (e.g. /ar/garbage).
 * Without it, such URLs fall outside the [locale] tree and get the
 * unlocalized root 404; calling notFound() here renders the localized
 * app/[locale]/not-found.tsx inside the proper document instead. This is
 * next-intl's documented error-files pattern.
 */
export default function CatchAllNotFound(): never {
  notFound();
}
