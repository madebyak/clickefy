/**
 * The dedicated pricing page.
 *
 * The home page carries a pricing SECTION for people already scrolling.
 * This is the page you land on from the nav, from an ad, or from a
 * "how much is it?" search — so it answers the question in full: what the
 * plans cost, and what those credits actually buy.
 *
 * A server component, so the headline and metadata are in the initial
 * HTML for crawlers and for anyone on a slow connection; the two
 * interactive pieces below fetch their own numbers from the API.
 */

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PricingSection } from "@/components/site/pricing-section";
import { ModelAllowanceTable } from "@/components/site/model-allowance-table";
import { TopupCard } from "@/components/site/topup-card";
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
  const t = await getTranslations({ locale, namespace: "pricing" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "pricing" });

  return (
    <main className="pb-24">
      {/* Headline. Deliberately short: the plans are the content, and a
          paragraph of positioning above them just delays the answer
          someone came here for. */}
      <header className="mx-auto max-w-3xl px-4 pt-16 text-center sm:px-6 sm:pt-24">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          {t("pageHeading")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
          {t("pageSub")}
        </p>
      </header>

      <div className="mt-12">
        <PricingSection embedded />
      </div>

      <TopupCard />

      <ModelAllowanceTable />

      {/* The questions people ask right before paying. Placed after the
          table because that is where the remaining doubt lives. */}
      <section className="mx-auto mt-24 max-w-3xl px-4 sm:px-6">
        <h2 className="text-center text-xl font-semibold">{t("faqTitle")}</h2>
        <dl className="mt-6 space-y-4">
          {(["Credits", "Reset", "Cancel", "Mobile"] as const).map((k) => (
            <div key={k} className="rounded-xl bg-surface-2 p-5">
              <dt className="font-medium">{t(`faq${k}Q`)}</dt>
              <dd className="mt-2 text-sm text-muted-foreground">{t(`faq${k}A`)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
