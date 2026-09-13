import Link from "next/link";
import { Geist } from "next/font/google";
import { BrandLogo } from "@/components/site/brand-logo";
// The root layout is a passthrough and never imports the global styles —
// without this import the page would render completely unstyled.
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });

const SUGGESTIONS = [
  { label: "Templates", href: "/templates" },
  { label: "Pricing", href: "/pricing" },
  { label: "Blog", href: "/blog" },
] as const;

/**
 * Root 404 — renders for paths outside the [locale] tree, and for the
 * unknown-locale case where [locale]/layout.tsx calls notFound() before
 * the localized document is established. Because the root layout is a
 * passthrough (no <html>/<body>), this page supplies its own, its font,
 * and its title. Copy is English-only by necessity: no locale/intl context
 * exists here. Same design as the localized 404, minus the site chrome
 * that needs that context.
 */
export default function NotFound() {
  return (
    <html lang="en" className={`dark ${geistSans.variable}`}>
      <body className="bg-background text-foreground antialiased">
        <title>Page not found — Clickefy</title>
        <meta name="robots" content="noindex" />
        <div className="flex min-h-dvh flex-col">
          <header className="mx-auto flex h-16 w-full max-w-site items-center site-px">
            <Link href="/" aria-label="Clickefy home">
              <BrandLogo eager />
            </Link>
          </header>

          <main className="flex flex-1 items-center py-10 sm:py-16">
            <section className="mx-auto w-full max-w-site site-px">
              <div className="relative overflow-hidden rounded-3xl bg-surface-1 px-6 py-16 text-center ring-1 ring-border sm:px-12 sm:py-24">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(66,214,118,0.16),transparent_70%)]" />
                <p
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-4 select-none text-[9rem] font-semibold leading-none tracking-tighter text-white/[0.035] sm:text-[15rem]"
                >
                  404
                </p>

                <div className="relative mx-auto flex max-w-xl flex-col items-center">
                  <p className="font-mono text-xs uppercase tracking-widest text-primary">404</p>
                  <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
                    Page not found
                  </h1>
                  <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                    The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
                  </p>
                  <Link
                    href="/"
                    className="mt-8 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Back to home
                  </Link>
                </div>

                <div className="relative mx-auto mt-14 max-w-2xl border-t border-border pt-8">
                  <p className="text-sm text-muted-foreground">Or head somewhere useful</p>
                  <ul className="mt-4 flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <li key={s.href}>
                        <Link
                          href={s.href}
                          className="inline-flex h-9 items-center rounded-full bg-surface-2 px-4 text-sm font-medium text-foreground ring-1 ring-border transition-colors hover:bg-surface-3"
                        >
                          {s.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          </main>
        </div>
      </body>
    </html>
  );
}
