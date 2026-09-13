import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Workspace } from "@/components/studio/workspace";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("createImage") };
}

export default function CreateImagePage() {
  return <Workspace kind="image" />;
}
