/**
 * /about — what Clickefy is and how it works, for someone deciding
 * whether to sign up. Editorial layout: a statement hero, the product in
 * three steps, the model roster we actually run (real brand marks, no
 * invented logos), the tools, and the credit model. Every fact here is
 * true of the shipped product — no invented history, headcount or
 * customer numbers. Copy lives in the `about` i18n namespace.
 */

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  Coins,
  FilmSlate,
  FolderSimple,
  ImageSquare,
  Lightning,
  ShieldCheck,
  Sparkle,
  VideoCamera,
  Wrench,
} from "@phosphor-icons/react/dist/ssr";

import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

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

/** The families in the studio today, with the same wordmarks the homepage uses. */
const MODEL_FAMILIES = [
  { name: "Google Gemini", wordmark: "/models/gemini-wordmark.svg", height: "h-6", key: "gemini" },
  { name: "OpenAI", wordmark: "/models/openai-wordmark.svg", height: "h-5", key: "openai" },
  { name: "Kling AI", wordmark: "/models/kling-wordmark.svg", height: "h-5", key: "kling" },
  { name: "ByteDance", wordmark: "/models/bytedance-wordmark.svg", height: "h-4", key: "bytedance" },
] as const;

const STEPS = [
  { key: "step1", Icon: Sparkle },
  { key: "step2", Icon: Lightning },
  { key: "step3", Icon: FolderSimple },
] as const;

const PILLARS = [
  { key: "images", Icon: ImageSquare, tint: "text-primary", bg: "bg-primary/15" },
  { key: "video", Icon: FilmSlate, tint: "text-[#b98aff]", bg: "bg-brand-purple/20" },
  { key: "tools", Icon: Wrench, tint: "text-accent-turquoise", bg: "bg-accent-turquoise/15" },
  { key: "credits", Icon: Coins, tint: "text-[#f5c542]", bg: "bg-[#f5c542]/15" },
] as const;

const PRINCIPLES = [
  { key: "honestPricing", Icon: Coins },
  { key: "yourWork", Icon: FolderSimple },
  { key: "safety", Icon: ShieldCheck },
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
        {/* ── Statement hero ─────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-site site-px">
          <div className="relative mt-4 overflow-hidden rounded-3xl bg-surface-1 px-6 py-16 sm:px-12 sm:py-24">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_20%_0%,rgba(99,3,224,0.28),transparent_60%),radial-gradient(50%_50%_at_90%_100%,rgba(0,220,174,0.14),transparent_60%)]" />
            <div className="relative max-w-3xl">
              <p className="font-mono text-xs uppercase tracking-widest text-brand-green">
                {t("kicker")}
              </p>
              <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                {t("pageHeading")}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                {t("pageSub")}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/create" className={buttonVariants({ size: "lg" })}>
                  {t("ctaPrimary")}
                  <ArrowRight className="size-4 rtl:-scale-x-100" />
                </Link>
                <Link
                  href="/models"
                  className={buttonVariants({ variant: "outline", size: "lg" })}
                >
                  {t("ctaSecondary")}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── The models we run ──────────────────────────────────── */}
        <section className="mx-auto mt-6 w-full max-w-site site-px">
          <div className="rounded-3xl bg-surface-2 px-6 py-10 sm:px-12">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-md">
                <h2 className="text-xl font-semibold tracking-tight">{t("modelsHeading")}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{t("modelsSub")}</p>
              </div>
              <ul className="flex flex-wrap items-center gap-x-10 gap-y-6">
                {MODEL_FAMILIES.map((m) => (
                  <li key={m.key} className="flex items-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.wordmark}
                      alt={m.name}
                      className={cn("w-auto opacity-90", m.height)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────────── */}
        <section className="mx-auto mt-20 w-full max-w-site site-px">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {t("howKicker")}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("howHeading")}
            </h2>
          </div>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map(({ key, Icon }, i) => (
              <li
                key={key}
                className="relative flex flex-col rounded-2xl bg-surface-1 p-6 ring-1 ring-border"
              >
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-xl bg-surface-2">
                    <Icon weight="fill" className="size-5 text-primary" />
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold">{t(`${key}Title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`${key}Body`)}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── What's inside ──────────────────────────────────────── */}
        <section className="mx-auto mt-20 w-full max-w-site site-px">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {t("insideKicker")}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("insideHeading")}
            </h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {PILLARS.map(({ key, Icon, tint, bg }) => (
              <div
                key={key}
                className="group rounded-2xl bg-surface-1 p-6 ring-1 ring-border transition-colors hover:ring-surface-3"
              >
                <span className={cn("grid size-11 place-items-center rounded-xl", bg)}>
                  <Icon weight="fill" className={cn("size-5", tint)} />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{t(`${key}Title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`${key}Body`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Tools spotlight ────────────────────────────────────── */}
        <section className="mx-auto mt-20 w-full max-w-site site-px">
          <div className="grid gap-4 lg:grid-cols-2">
            <Link
              href="/create?tool=camera"
              className="group relative flex min-h-[260px] flex-col justify-end overflow-hidden rounded-3xl bg-surface-2 p-8 ring-1 ring-border transition-colors hover:ring-surface-3"
            >
              <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(var(--color-border)_1px,transparent_1px),linear-gradient(90deg,var(--color-border)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_70%_30%,black,transparent_70%)]" />
              <span className="relative grid size-11 place-items-center rounded-xl bg-accent-turquoise/15">
                <VideoCamera weight="fill" className="size-5 text-accent-turquoise" />
              </span>
              <h3 className="relative mt-5 text-2xl font-semibold tracking-tight">
                {t("cameraTitle")}
              </h3>
              <p className="relative mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {t("cameraBody")}
              </p>
              <span className="relative mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                {t("tryIt")} <ArrowRight className="size-4 rtl:-scale-x-100" />
              </span>
            </Link>
            <Link
              href="/create?tool=storyboard"
              className="group relative flex min-h-[260px] flex-col justify-end overflow-hidden rounded-3xl bg-surface-2 p-8 ring-1 ring-border transition-colors hover:ring-surface-3"
            >
              <div className="pointer-events-none absolute end-8 top-8 flex gap-2 opacity-70">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="block h-14 w-20 rounded-lg border border-border bg-surface-3"
                    style={{ transform: `translateY(${i * 6}px)` }}
                  />
                ))}
              </div>
              <span className="relative grid size-11 place-items-center rounded-xl bg-brand-purple/20">
                <FilmSlate weight="fill" className="size-5 text-[#b98aff]" />
              </span>
              <h3 className="relative mt-5 text-2xl font-semibold tracking-tight">
                {t("storyboardTitle")}
              </h3>
              <p className="relative mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {t("storyboardBody")}
              </p>
              <span className="relative mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                {t("tryIt")} <ArrowRight className="size-4 rtl:-scale-x-100" />
              </span>
            </Link>
          </div>
        </section>

        {/* ── Principles ─────────────────────────────────────────── */}
        <section className="mx-auto mt-20 w-full max-w-site site-px">
          <div className="rounded-3xl bg-surface-1 p-8 ring-1 ring-border sm:p-12">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {t("principlesKicker")}
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                {t("principlesHeading")}
              </h2>
            </div>
            <dl className="mt-10 grid gap-8 md:grid-cols-3">
              {PRINCIPLES.map(({ key, Icon }) => (
                <div key={key}>
                  <dt className="flex items-center gap-2.5 text-base font-semibold">
                    <Icon weight="fill" className="size-4 text-primary" />
                    {t(`${key}Title`)}
                  </dt>
                  <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`${key}Body`)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Company + CTA ──────────────────────────────────────── */}
        <section className="mx-auto mt-20 w-full max-w-site site-px">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl bg-surface-2 p-6 lg:col-span-1">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {t("companyKicker")}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {t("companyBody")}
              </p>
              <ul className="mt-4 space-y-1.5 text-sm">
                <li>
                  <Link href="/contact" className="text-primary underline-offset-4 hover:underline">
                    {t("companyContact")}
                  </Link>
                </li>
                <li>
                  <Link href="/blog" className="text-primary underline-offset-4 hover:underline">
                    {t("companyBlog")}
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-primary underline-offset-4 hover:underline">
                    {t("companyLegal")}
                  </Link>
                </li>
              </ul>
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-surface-1 p-8 ring-1 ring-border lg:col-span-2">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_100%_0%,rgba(99,3,224,0.22),transparent_60%)]" />
              <h2 className="relative text-2xl font-semibold tracking-tight sm:text-3xl">
                {t("ctaHeading")}
              </h2>
              <p className="relative mt-3 max-w-lg text-muted-foreground">{t("ctaSub")}</p>
              <div className="relative mt-6 flex flex-wrap items-center gap-3">
                <Link href="/create" className={buttonVariants({ size: "lg" })}>
                  {t("ctaPrimary")}
                </Link>
                <Link
                  href="/pricing"
                  className={buttonVariants({ variant: "outline", size: "lg" })}
                >
                  {t("ctaPricing")}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
