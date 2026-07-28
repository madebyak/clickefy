import { SignUp } from "@clerk/nextjs";
import { setRequestLocale } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";

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
