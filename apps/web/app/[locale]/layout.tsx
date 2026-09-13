import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Geist, Geist_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { arSA } from "@clerk/localizations";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Toaster } from "sonner";
import { routing } from "@/i18n/routing";
import { config } from "@/lib/config";
import { SHARE_IMAGE, sharedOpenGraph } from "@/lib/page-metadata";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { Providers } from "@/components/providers";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });
// All four weights are genuinely used by the UI (500 and 600 heavily), so
// none can be dropped.
//
// `preload: false` is deliberate. Both locales share this layout, so Next
// emits <link rel=preload> for every font here on EVERY page — which on a
// Latin page force-downloads ~121 KB of Arabic faces that are never drawn.
// The generated @font-face already carries a `unicode-range` limited to
// Arabic codepoints, so without the preload tag the browser fetches these
// files only when Arabic glyphs are actually present: skipped entirely on
// /en, fetched during first layout on /ar. Removing the preload restores
// that built-in optimisation rather than trading it away.
const ibmArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-ibm-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Browser chrome colour (mobile address bar, installed-app title bar) and
 * native form controls, matched to the site: always dark, on the same
 * black as `--background` and the manifest's theme_color.
 */
export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

/**
 * Production Clerk keys encode the frontend-API host (base64 between
 * `pk_live_` and a trailing `$`). Passing it as ClerkProvider's `domain`
 * pins the SDK to direct frontend-API mode and disables its .vercel.app
 * auto-proxy heuristic. Without this, a custom domain fronting a Vercel
 * deployment whose baked VERCEL_PROJECT_PRODUCTION_URL still names the
 * *.vercel.app host half-engages the proxy — the page loads clerk-js
 * from /__clerk while the middleware (request-host-based) declines to
 * serve it → HTML 404 under nosniff → blank sign-in. Dev keys return
 * undefined and keep the default dev-instance behavior.
 */
function liveClerkDomain(): string | undefined {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  if (!pk.startsWith("pk_live_")) return undefined;
  try {
    const host = Buffer.from(pk.slice("pk_live_".length), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    return host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Layout metadata carries only path-independent fields. Canonical,
 * hreflang alternates, and og:url are deliberately NOT set here —
 * Next merges metadata shallowly and pages inherit the layout's values
 * verbatim, so a layout-level canonical would make every page (e.g.
 * /templates) declare itself a duplicate of the homepage. Pages that
 * should rank set their own via `localizedPageMetadata()`.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(config.siteUrl),
    // Pages give their short name ("Pricing") and the brand is added once,
    // here. The home page shares this segment, so the template does not
    // apply to it and it takes `default` — the full product title.
    title: { default: t("title"), template: "%s — Clickefy" },
    description: t("description"),
    applicationName: "Clickefy",
    // The name under the icon when the site is added to an iPhone home screen.
    appleWebApp: { title: "Clickefy" },
    openGraph: {
      title: t("title"),
      description: t("description"),
      ...sharedOpenGraph(locale),
    },
    // No title or description here on purpose: pages inherit this object
    // whole, so setting them would stamp the homepage's title on every
    // page's card. Without them, X's card processor falls back to each
    // page's own og:title and og:description.
    twitter: {
      card: "summary_large_image",
      images: [SHARE_IMAGE.url],
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      suppressHydrationWarning
      className={`dark ${geistSans.variable} ${geistMono.variable} ${ibmArabic.variable}`}
    >
      <body>
        {/* ClerkProvider lives inside <body> (Core-3 convention). Sign-in /
            sign-up paths are locale-aware, so we compute them here instead
            of relying on the static NEXT_PUBLIC_CLERK_SIGN_IN_URL. */}
        <ClerkProvider
          appearance={clerkAppearance}
          localization={locale === "ar" ? arSA : undefined}
          signInUrl={locale === "ar" ? "/ar/sign-in" : "/sign-in"}
          signUpUrl={locale === "ar" ? "/ar/sign-up" : "/sign-up"}
          domain={liveClerkDomain()}
        >
          <NextIntlClientProvider>
            <Providers>{children}</Providers>
          </NextIntlClientProvider>
        </ClerkProvider>
        <Toaster richColors position="top-right" theme="dark" />
      </body>
    </html>
  );
}
