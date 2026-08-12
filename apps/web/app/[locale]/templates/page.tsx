/**
 * Public template gallery — browsable without sign-in (the catalog
 * endpoints are public; running a template still goes through the
 * auth-gated /templates/[id] page). Server shell so Navbar/Footer
 * render exactly as on the homepage; the interactive gallery is a
 * client component.
 */

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { TemplatesGallery } from "@/components/templates/templates-gallery";
import { localizedPageMetadata } from "@/lib/page-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "templates" });
  return {
    title: `${t("galleryHeading")} — Clickefy`,
    description: t("gallerySub"),
    ...localizedPageMetadata(locale, "/templates"),
  };
}

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar />
      <TemplatesGallery />
      <Footer />
    </div>
  );
}
