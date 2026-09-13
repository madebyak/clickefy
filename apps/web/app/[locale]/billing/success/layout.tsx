import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * Carries the tab title for the post-checkout page, which is a client
 * component and so cannot export metadata itself. Never indexed: it only
 * means anything straight after a Stripe payment.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing" });
  return { title: t("successTitle"), robots: { index: false, follow: false } };
}

export default function BillingSuccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
