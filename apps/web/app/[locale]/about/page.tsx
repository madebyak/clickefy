/**
 * /about — what Clickefy is, for the person who clicked the footer link
 * before deciding to sign up. Entirely static and factual: the product
 * pitch (one studio, the frontier models, honest credits), no invented
 * history or team page. All copy in the `about` i18n namespace.
 */

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ImageSquare,
  FilmSlate,
  Wrench,
  Coins,
} from "@phosphor-icons/react/dist/ssr";

import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
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
  const t = await getTranslations({ locale, namespace: "about" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    ...localizedPageMetadata(locale, "/about"),
  };
}

const PILLARS = [
  { key: "images", Icon: ImageSquare, tint: "text-primary" },
  { key: "video", Icon: FilmSlate, tint: "text-[#b98aff]" },
  { key: "tools", Icon: Wrench, tint: "text-[#00dcae]" },
  { key: "credits", Icon: Coins, tint: "text-[#f5c542]" },
] as const;

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "about" });

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar />

      <main className="pb-24">
        <header className="mx-auto max-w-3xl px-4 pt-16 text-center sm:px-6 sm:pt-24">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {t("pageHeading")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            {t("pageSub")}
          </p>
        </header>

        <section className="mx-auto mt-16 w-full max-w-site site-px">
          <div className="grid gap-3 sm:grid-cols-2">
            {PILLARS.map(({ key, Icon, tint }) => (
              <div key={key} className="rounded-2xl bg-surface-1 p-6 ring-1 ring-border">
                <span className="grid size-10 place-items-center rounded-xl bg-surface-2">
                  <Icon weight="fill" className={`size-5 ${tint}`} />
                </span>
                <h2 className="mt-4 font-semibold">{t(`${key}Title`)}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {t(`${key}Body`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-20 max-w-2xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("ctaHeading")}
          </h2>
          <p className="mt-3 text-muted-foreground">{t("ctaSub")}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/create" className={buttonVariants({ size: "lg" })}>
              {t("ctaPrimary")}
            </Link>
            <Link
              href="/models"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              {t("ctaSecondary")}
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
