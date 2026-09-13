import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  // A sign-in form is never a useful search result.
  return { title: t("login"), robots: { index: false, follow: true } };
}

/**
 * Catch-all sign-in route for Clerk's prebuilt component (handles
 * email + code, Google, Apple, new-device verification — everything
 * enabled on the Clerk instance). `path` must include the locale
 * prefix, which is why it's computed instead of hardcoded.
 */
export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const prefix = locale === "en" ? "" : `/${locale}`;

  return (
    <AuthShell>
      <SignIn path={`${prefix}/sign-in`} fallbackRedirectUrl={`${prefix}/create`} />
    </AuthShell>
  );
}
