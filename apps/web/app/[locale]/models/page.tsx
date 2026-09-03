/**
 * The /models page — the roster of every model in the studio with its
 * real per-generation price, for people deciding whether Clickefy
 * carries the model they care about. Linked from the footer's Explore
 * column. The catalogue itself is client-side (live prices from the
 * API); the headline is server-rendered for crawlers.
 */

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { ModelsCatalog } from "@/components/site/models-catalog";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "modelsPage" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    ...localizedPageMetadata(locale, "/models"),
  };
}

export default async function ModelsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "modelsPage" });

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar />

      <main className="pb-24">
        <header className="mx-auto max-w-3xl px-4 pt-16 text-center sm:px-6 sm:pt-24">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {t("pageHeading")}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            {t("pageSub")}
          </p>
        </header>

        <ModelsCatalog />
      </main>

      <Footer />
    </div>
  );
}
