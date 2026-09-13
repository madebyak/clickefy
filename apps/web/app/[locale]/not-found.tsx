import Image from "next/image";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { Link } from "@/i18n/navigation";
import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Where a lost visitor can usefully go next. Labels reuse the footer's, so
 * the 404 never names a page differently from the rest of the site.
 */
const SUGGESTIONS = [
  { label: "linkCreateImage", href: "/create" },
  { label: "linkTemplates", href: "/templates" },
  { label: "linkPricing", href: "/pricing" },
  { label: "linkBlog", href: "/blog" },
] as const;

/**
 * Locale-aware 404. Rendered when a route segment inside [locale] calls
 * notFound() (an unknown path, a missing post). Inside the full site
 * chrome, so a lost visitor still has the navbar and footer to hand, and
 * built from the blog header's pieces — the surface-1 panel and the green
 * wash — so it reads as part of the site rather than an error screen.
 * The tab title comes from `[...rest]/page.tsx`: this file cannot export
 * metadata.
 */
export default function LocaleNotFound() {
  const t = useTranslations("errors");
  const tf = useTranslations("footer");

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Navbar />

      <main className="flex flex-1 items-center py-10 sm:py-16">
        <section className="mx-auto w-full max-w-site site-px">
          <div className="relative overflow-hidden rounded-3xl bg-surface-1 px-6 py-16 text-center ring-1 ring-border sm:px-12 sm:py-24">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(66,214,118,0.16),transparent_70%)]" />
            {/* The code, huge and nearly invisible — texture, not content.
                Pinned LTR: digits read the same in every locale. */}
            <p
              aria-hidden
              dir="ltr"
              className="pointer-events-none absolute inset-x-0 top-4 select-none text-[9rem] font-semibold leading-none tracking-tighter text-white/[0.035] sm:text-[15rem]"
            >
              404
            </p>

            <div className="relative mx-auto flex max-w-xl flex-col items-center">
              <Image src="/brand/logo-mark.svg" alt="" width={48} height={55} />
              <p dir="ltr" className="mt-8 font-mono text-xs uppercase tracking-widest text-primary">
                404
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
                {t("notFoundTitle")}
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                {t("notFoundBody")}
              </p>
              <Link href="/" className={cn(buttonVariants({ size: "md" }), "mt-8")}>
                <ArrowLeft className="size-4 rtl:-scale-x-100" />
                {t("goHome")}
              </Link>
            </div>

            <div className="relative mx-auto mt-14 max-w-2xl border-t border-border pt-8">
              <p className="text-sm text-muted-foreground">{t("notFoundSuggestions")}</p>
              <ul className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <li key={s.href}>
                    <Link
                      href={s.href}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-sm font-medium text-foreground ring-1 ring-border transition-colors hover:bg-surface-3"
                    >
                      {tf(s.label)}
                      <ArrowRight className="size-3.5 text-muted-foreground rtl:-scale-x-100" />
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
