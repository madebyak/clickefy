/**
 * /contact — how to reach Clickefy, routed by intent. One support inbox
 * behind it all, but each topic pre-fills a subject line so a billing
 * question and a bug report do not arrive looking identical, plus the
 * self-serve answers most people were about to ask for. No form: a form
 * we cannot yet triage is worse than a mailto that lands in the inbox
 * the team actually reads.
 */

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  Bug,
  CreditCard,
  EnvelopeSimple,
  Handshake,
  Megaphone,
  Question,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";

import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { Link } from "@/i18n/navigation";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

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

/** Intent → subject line. All go to the one inbox; the subject does the triage. */
const TOPICS = [
  { key: "support", Icon: Question, subject: "Support", tint: "text-primary", bg: "bg-primary/15" },
  { key: "billing", Icon: CreditCard, subject: "Billing", tint: "text-[#f5c542]", bg: "bg-[#f5c542]/15" },
  { key: "bug", Icon: Bug, subject: "Bug report", tint: "text-status-red", bg: "bg-status-red/15" },
  { key: "partnerships", Icon: Handshake, subject: "Partnership", tint: "text-accent-turquoise", bg: "bg-accent-turquoise/15" },
  { key: "press", Icon: Megaphone, subject: "Press", tint: "text-[#b98aff]", bg: "bg-brand-purple/20" },
  { key: "trust", Icon: ShieldCheck, subject: "Trust & Safety", tint: "text-status-green", bg: "bg-status-green/15" },
] as const;

const SHORTCUTS = [
  { key: "pricing", href: "/pricing" },
  { key: "models", href: "/models" },
  { key: "dmca", href: "/dmca" },
  { key: "accountDeletion", href: "/account-deletion" },
  { key: "contentPolicy", href: "/content-policy" },
  { key: "aiDisclosure", href: "/ai-disclosure" },
] as const;

function mailto(subject: string) {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[Clickefy] ${subject}`)}`;
}

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
        {/* ── Hero + primary inbox ───────────────────────────────── */}
        <section className="mx-auto w-full max-w-site site-px">
          <div className="relative mt-4 overflow-hidden rounded-3xl bg-surface-1 px-6 py-14 sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_70%_at_90%_0%,rgba(0,220,174,0.16),transparent_60%),radial-gradient(50%_60%_at_0%_100%,rgba(99,3,224,0.22),transparent_60%)]" />
            <div className="relative grid gap-10 lg:grid-cols-5 lg:items-end">
              <div className="lg:col-span-3">
                <p className="font-mono text-xs uppercase tracking-widest text-brand-green">
                  {t("kicker")}
                </p>
                <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
                  {t("pageHeading")}
                </h1>
                <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
                  {t("pageSub")}
                </p>
              </div>
              <a
                href={mailto("Hello")}
                className="group relative flex items-center gap-4 rounded-2xl bg-background/60 p-5 ring-1 ring-border backdrop-blur transition-colors hover:ring-primary/50 lg:col-span-2"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/15">
                  <EnvelopeSimple weight="fill" className="size-6 text-primary" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-muted-foreground">{t("emailTitle")}</span>
                  <span className="block truncate font-semibold" dir="ltr">
                    {SUPPORT_EMAIL}
                  </span>
                </span>
                <ArrowRight className="ms-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
              </a>
            </div>
          </div>
        </section>

        {/* ── Route by topic ─────────────────────────────────────── */}
        <section className="mx-auto mt-16 w-full max-w-site site-px">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("topicsHeading")}
            </h2>
            <p className="mt-2 text-muted-foreground">{t("topicsSub")}</p>
          </div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TOPICS.map(({ key, Icon, subject, tint, bg }) => (
              <li key={key}>
                <a
                  href={mailto(subject)}
                  className="group flex h-full flex-col rounded-2xl bg-surface-1 p-6 ring-1 ring-border transition-colors hover:ring-surface-3"
                >
                  <span className={cn("grid size-10 place-items-center rounded-xl", bg)}>
                    <Icon weight="fill" className={cn("size-5", tint)} />
                  </span>
                  <h3 className="mt-4 font-semibold">{t(`${key}Title`)}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {t(`${key}Body`)}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                    {t("writeToUs")}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* ── What helps us help you + self-serve ────────────────── */}
        <section className="mx-auto mt-16 w-full max-w-site site-px">
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="rounded-2xl bg-surface-2 p-6 lg:col-span-2">
              <h2 className="text-lg font-semibold">{t("tipsHeading")}</h2>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                {(["tip1", "tip2", "tip3"] as const).map((k) => (
                  <li key={k} className="flex gap-3">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="leading-relaxed">{t(k)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-surface-1 p-6 ring-1 ring-border lg:col-span-3">
              <h2 className="text-lg font-semibold">{t("shortcutsHeading")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("shortcutsSub")}</p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {SHORTCUTS.map((s) => (
                  <li key={s.key}>
                    <Link
                      href={s.href}
                      className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm transition-colors hover:bg-surface-3"
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
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
