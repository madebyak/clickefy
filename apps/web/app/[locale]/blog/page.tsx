/**
 * /blog — product notes and guides. Posts are authored in
 * `lib/blog/posts.ts` (see the rationale there); this page is a static
 * index, newest first, with the lead post given a wide card so the page
 * has a front rather than a list.
 */

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { Link } from "@/i18n/navigation";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { routing, type Locale } from "@/i18n/routing";
import { listPosts, type BlogPost } from "@/lib/blog/posts";
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
  const t = await getTranslations({ locale, namespace: "blog" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    ...localizedPageMetadata(locale, "/blog"),
  };
}

/** Card wash per accent — gradients so the index has colour without images. */
export const ACCENT_WASH: Record<BlogPost["accent"], string> = {
  green: "bg-[radial-gradient(80%_80%_at_0%_0%,rgba(66,214,118,0.28),transparent_60%)]",
  purple: "bg-[radial-gradient(80%_80%_at_100%_0%,rgba(99,3,224,0.35),transparent_60%)]",
  turquoise: "bg-[radial-gradient(80%_80%_at_0%_100%,rgba(0,220,174,0.22),transparent_60%)]",
  gold: "bg-[radial-gradient(80%_80%_at_100%_100%,rgba(245,197,66,0.22),transparent_60%)]",
};

export function formatPostDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${iso}T00:00:00Z`));
}

export default async function BlogIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "blog" });
  const loc = (routing.locales.includes(locale as Locale) ? locale : routing.defaultLocale) as Locale;
  const [lead, ...rest] = listPosts();

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar />

      <main className="pb-24">
        <header className="mx-auto w-full max-w-site pt-14 site-px sm:pt-20">
          <p className="font-mono text-xs uppercase tracking-widest text-brand-green">
            {t("kicker")}
          </p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            {t("pageHeading")}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">{t("pageSub")}</p>
        </header>

        <section className="mx-auto mt-12 w-full max-w-site site-px">
          {lead && (
            <Link
              href={`/blog/${lead.slug}`}
              className={cn(
                "group relative flex min-h-[320px] flex-col justify-end overflow-hidden rounded-3xl bg-surface-1 p-8 ring-1 ring-border transition-colors hover:ring-surface-3 sm:p-12",
              )}
            >
              <div className={cn("pointer-events-none absolute inset-0", ACCENT_WASH[lead.accent])} />
              <div className="relative flex items-center gap-3 text-xs text-muted-foreground">
                <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-foreground">
                  {t(`tag_${lead.tag}`)}
                </span>
                <time dateTime={lead.date}>{formatPostDate(lead.date, locale)}</time>
                <span aria-hidden>·</span>
                <span>{t("readTime", { minutes: lead.readMinutes })}</span>
              </div>
              <h2 className="relative mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                {lead.content[loc].title}
              </h2>
              <p className="relative mt-3 max-w-2xl text-muted-foreground">
                {lead.content[loc].excerpt}
              </p>
              <span className="relative mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                {t("readPost")}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
              </span>
            </Link>
          )}

          {rest.length > 0 && (
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {rest.map((post) => (
                <li key={post.slug}>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="group relative flex h-full min-h-[240px] flex-col justify-end overflow-hidden rounded-3xl bg-surface-1 p-7 ring-1 ring-border transition-colors hover:ring-surface-3"
                  >
                    <div className={cn("pointer-events-none absolute inset-0", ACCENT_WASH[post.accent])} />
                    <div className="relative flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-foreground">
                        {t(`tag_${post.tag}`)}
                      </span>
                      <time dateTime={post.date}>{formatPostDate(post.date, locale)}</time>
                      <span aria-hidden>·</span>
                      <span>{t("readTime", { minutes: post.readMinutes })}</span>
                    </div>
                    <h2 className="relative mt-4 text-2xl font-semibold leading-tight tracking-tight">
                      {post.content[loc].title}
                    </h2>
                    <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">
                      {post.content[loc].excerpt}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
