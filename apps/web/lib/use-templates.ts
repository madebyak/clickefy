"use client";

/**
 * Template catalog queries — public endpoints (`GET /v1/catalog/*`),
 * no auth required. Locale flows through the SDK's `getLocale` bridge
 * so Arabic users get translated titles server-side.
 */

import { useQuery } from "@tanstack/react-query";
import type { CatalogTemplate } from "@clickfy/sdk";
import { getSDK } from "@/lib/api";
import { rebaseAssetUrl } from "@/lib/rebase-url";
import { useLocale } from "next-intl";

const rebaseTemplate = (t: CatalogTemplate): CatalogTemplate => ({
  ...t,
  coverImage: rebaseAssetUrl(t.coverImage),
  previewVideo: t.previewVideo ? rebaseAssetUrl(t.previewVideo) : t.previewVideo,
  gallery: t.gallery?.map(rebaseAssetUrl),
});

export function useTemplateCategories() {
  const locale = useLocale();
  return useQuery({
    queryKey: ["catalog", "categories", locale],
    queryFn: () => getSDK().catalog.listCategories(),
    staleTime: 5 * 60_000,
  });
}

export function useTemplates(opts: {
  categoryId?: string;
  search?: string;
  kind?: "image" | "video" | "image_set" | "video_image";
}) {
  const locale = useLocale();
  return useQuery({
    queryKey: [
      "catalog",
      "templates",
      locale,
      opts.categoryId ?? "all",
      opts.search ?? "",
      opts.kind ?? "all",
    ],
    queryFn: async () => {
      const page = await getSDK().catalog.listTemplates({
        categoryId: opts.categoryId,
        search: opts.search || undefined,
        kind: opts.kind,
        limit: 50,
      });
      return { ...page, items: page.data.map(rebaseTemplate) };
    },
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useTemplate(id: string) {
  const locale = useLocale();
  return useQuery({
    queryKey: ["catalog", "template", locale, id],
    queryFn: async () => rebaseTemplate(await getSDK().catalog.getTemplate(id)),
    staleTime: 60_000,
  });
}
