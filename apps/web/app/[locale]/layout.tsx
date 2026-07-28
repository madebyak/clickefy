import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Geist, Geist_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { arSA } from "@clerk/localizations";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Toaster } from "sonner";
import { routing } from "@/i18n/routing";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { Providers } from "@/components/providers";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });
const ibmArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-ibm-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
  metadataBase: new URL("https://clickefy-webb.vercel.app"),
  title: "Clickefy — AI Creator Studio",
  description:
    "Professional AI image and video generation. Create with Nano Banana, Kling, Seedance and more.",
  alternates: { languages: { en: "/", ar: "/ar" } },
};

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
