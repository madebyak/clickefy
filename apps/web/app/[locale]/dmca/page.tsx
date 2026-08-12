import type { Metadata } from "next";
import { LegalDocPage } from "@/components/legal/legal-doc-page";
import { LEGAL_DOCS } from "@/lib/legal-content";
import { localizedPageMetadata } from "@/lib/page-metadata";

const SLUG = "dmca" as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const doc = LEGAL_DOCS[SLUG];
  return {
    title: `${doc.title} — Clickefy`,
    description: doc.summary,
    ...localizedPageMetadata(locale, "/dmca"),
  };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <LegalDocPage slug={SLUG} locale={locale} />;
}
