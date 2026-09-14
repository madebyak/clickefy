"use client";

/**
 * Template catalog queries — public endpoints (`GET /v1/catalog/*`),
 * no auth required. Locale flows through the SDK's `getLocale` bridge
 * so Arabic users get translated titles server-side.
 */

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
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

type TemplateFilters = {
  categoryId?: string;
  search?: string;
  kind?: "image" | "video" | "image_set" | "video_image";
};

type Sort = NonNullable<
  Parameters<ReturnType<typeof getSDK>["catalog"]["listTemplates"]>[0]
>["sort"];

/**
 * Newest first, everywhere on the web — except while searching.
 *
 * Browsing: `recent`. The API's `default` chain is featured, sort_order,
 * published, id, and every published row carries `sort_order = 0`, so a
 * template published today could otherwise land anywhere in the catalog.
 *
 * Searching: `default`, because only that sort puts the relevance rank in
 * front (exact title, then title prefix, then every word in a title, then
 * description/category matches). Under `recent` a search for "retro" would
 * list whatever mentions it most recently, not the template called Retro.
 */
const sortFor = (search?: string): Sort => (search?.trim() ? "default" : "recent");

/** The API caps `limit` at 50. */
const PAGE_SIZE = 50;

const templatesKey = (locale: string, opts: TemplateFilters) => [
  "catalog",
  "templates",
  locale,
  opts.categoryId ?? "all",
  opts.search ?? "",
  opts.kind ?? "all",
];

/**
 * One page of templates, for fixed-size surfaces like the homepage
 * rail. Use `useInfiniteTemplates` for the full browsable gallery.
 */
export function useTemplates(opts: TemplateFilters & { limit?: number }) {
  const locale = useLocale();
  const limit = opts.limit ?? PAGE_SIZE;
  return useQuery({
    queryKey: [...templatesKey(locale, opts), "single", limit],
    queryFn: async () => {
      const page = await getSDK().catalog.listTemplates({
        categoryId: opts.categoryId,
        search: opts.search || undefined,
        kind: opts.kind,
        sort: sortFor(opts.search),
        limit,
      });
      return { ...page, items: page.data.map(rebaseTemplate) };
    },
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

/**
 * The gallery's paginated feed.
 *
 * Previously the gallery rendered a single 50-row page with no cursor,
 * which left 221 of 271 published templates unreachable from the web at
 * any sort order.
 */
export function useInfiniteTemplates(opts: TemplateFilters & { enabled?: boolean }) {
  const locale = useLocale();
  return useInfiniteQuery({
    enabled: opts.enabled ?? true,
    queryKey: [...templatesKey(locale, opts), "infinite"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const page = await getSDK().catalog.listTemplates({
        categoryId: opts.categoryId,
        search: opts.search || undefined,
        kind: opts.kind,
        sort: sortFor(opts.search),
        limit: PAGE_SIZE,
        cursor: pageParam,
        // "12 templates" under the search box. Only while searching — the
        // count is a second query the plain browse view doesn't need.
        withCount: !!opts.search?.trim(),
      });
      return { ...page, items: page.data.map(rebaseTemplate) };
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
    // Keep the current results on screen while the next query loads, so
    // typing refines the grid instead of blanking it to skeletons on
    // every pause.
    placeholderData: keepPreviousData,
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
