/**
 * /blog/[slug] — one post. Static for every slug × locale. Typography is
 * the article's whole design: measure capped at ~65 characters, generous
 * leading, one accent for the kicker. The CTA at the end opens the
 * studio surface the post is about.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { routing, type Locale } from "@/i18n/routing";
import { BLOG_POSTS, getPost, listPosts, type BlogBlock } from "@/lib/blog/posts";
import { ACCENT_WASH, formatPostDate } from "../page";
import { cn } from "@/lib/utils";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    BLOG_POSTS.map((post) => ({ locale, slug: post.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  const loc = (routing.locales.includes(locale as Locale) ? locale : routing.defaultLocale) as Locale;
  const content = post.content[loc];
  return {
    title: `${content.title} — Clickefy`,
    description: content.excerpt,
    ...localizedPageMetadata(locale, `/blog/${slug}`),
  };
}

function Block({ block }: { block: BlogBlock }) {
  switch (block.type) {
    case "h2":
      return <h2 className="mt-12 text-2xl font-semibold tracking-tight">{block.text}</h2>;
    case "ul":
      return (
        <ul className="mt-5 space-y-3">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-[17px] leading-8 text-foreground/85">
              <span className="mt-3.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="mt-8 rounded-2xl bg-surface-2 p-6 text-lg leading-8 text-foreground/90 ring-1 ring-border">
          {block.text}
        </blockquote>
      );
    case "p":
    default:
      return <p className="mt-5 text-[17px] leading-8 text-foreground/85">{block.text}</p>;
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const post = getPost(slug);
  if (!post) notFound();
  const t = await getTranslations({ locale, namespace: "blog" });
  const loc = (routing.locales.includes(locale as Locale) ? locale : routing.defaultLocale) as Locale;
  const content = post.content[loc];
  const more = listPosts().filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar />

      <main className="pb-24">
        <article className="mx-auto w-full max-w-site site-px">
          {/* header */}
          <div className="relative mt-4 overflow-hidden rounded-3xl bg-surface-1 px-6 py-14 ring-1 ring-border sm:px-12 sm:py-20">
            <div className={cn("pointer-events-none absolute inset-0", ACCENT_WASH[post.accent])} />
            <div className="relative mx-auto max-w-3xl">
              <Link
                href="/blog"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-4 rtl:-scale-x-100" />
                {t("backToBlog")}
              </Link>
              <div className="mt-8 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-foreground">
                  {t(`tag_${post.tag}`)}
                </span>
                <time dateTime={post.date}>{formatPostDate(post.date, locale)}</time>
                <span aria-hidden>·</span>
                <span>{t("readTime", { minutes: post.readMinutes })}</span>
              </div>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
                {content.title}
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{content.excerpt}</p>
            </div>
          </div>

          {/* body */}
          <div className="mx-auto mt-12 max-w-2xl">
            {content.body.map((block, i) => (
              <Block key={i} block={block} />
            ))}

            <div className="mt-14 rounded-2xl bg-surface-2 p-6 ring-1 ring-border sm:p-8">
              <p className="text-lg font-semibold">{t("ctaHeading")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("ctaSub")}</p>
              <Link href={post.cta.href} className={cn(buttonVariants({ size: "md" }), "mt-5")}>
                {t("ctaButton")}
                <ArrowRight className="size-4 rtl:-scale-x-100" />
              </Link>
            </div>
          </div>
        </article>

        {more.length > 0 && (
          <section className="mx-auto mt-20 w-full max-w-site site-px">
            <h2 className="text-xl font-semibold tracking-tight">{t("moreHeading")}</h2>
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {more.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/blog/${p.slug}`}
                    className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-surface-1 p-6 ring-1 ring-border transition-colors hover:ring-surface-3"
                  >
                    <div className={cn("pointer-events-none absolute inset-0", ACCENT_WASH[p.accent])} />
                    <span className="relative text-xs text-muted-foreground">
                      {t(`tag_${p.tag}`)} · {formatPostDate(p.date, locale)}
                    </span>
                    <h3 className="relative mt-3 text-lg font-semibold leading-snug">
                      {p.content[loc].title}
                    </h3>
                    <p className="relative mt-2 text-sm text-muted-foreground">{p.content[loc].excerpt}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
