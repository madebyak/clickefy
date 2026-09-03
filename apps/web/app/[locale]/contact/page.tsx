/**
 * /contact — how to reach Clickefy. One support address for questions,
 * feedback and billing, plus pointers to the pages that answer common
 * asks (pricing, legal, DMCA) so the inbox isn't the only path.
 */

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EnvelopeSimple, ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { Link } from "@/i18n/navigation";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { routing } from "@/i18n/routing";

const SUPPORT_EMAIL = "support@clickefy.ai";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    ...localizedPageMetadata(locale, "/contact"),
  };
}

const SHORTCUTS = [
  { key: "pricing", href: "/pricing" },
  { key: "dmca", href: "/dmca" },
  { key: "accountDeletion", href: "/account-deletion" },
] as const;

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "contact" });

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

        <section className="mx-auto mt-14 max-w-xl px-4 sm:px-6">
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="flex items-center gap-4 rounded-2xl bg-surface-1 p-6 ring-1 ring-border transition-colors hover:ring-surface-3"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/15">
              <EnvelopeSimple weight="fill" className="size-6 text-primary" />
            </span>
            <span>
              <span className="block font-semibold">{t("emailTitle")}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                {SUPPORT_EMAIL}
              </span>
            </span>
          </a>

          <div className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("shortcutsHeading")}
            </h2>
            <ul className="mt-3 divide-y divide-border/60 rounded-2xl bg-surface-1 ring-1 ring-border">
              {SHORTCUTS.map((s) => (
                <li key={s.key}>
                  <Link
                    href={s.href}
                    className="flex items-center justify-between gap-3 px-5 py-4 text-sm transition-colors hover:bg-surface-2"
                  >
                    <span>
                      <span className="block font-medium">{t(`${s.key}Title`)}</span>
                      <span className="mt-0.5 block text-muted-foreground">
                        {t(`${s.key}Sub`)}
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
