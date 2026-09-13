import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  // A sign-up form is never a useful search result.
  return { title: t("signup"), robots: { index: false, follow: true } };
}

export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const prefix = locale === "en" ? "" : `/${locale}`;

  return (
    <AuthShell>
      <SignUp path={`${prefix}/sign-up`} fallbackRedirectUrl={`${prefix}/create`} />
    </AuthShell>
  );
}
