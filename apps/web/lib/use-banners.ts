"use client";

/**
 * Admin-managed promotional banners — public `GET /v1/catalog/banners`.
 * The server already applied `is_active` + schedule-window filtering,
 * so whatever comes back is live right now. Managed from the admin
 * panel's Home Banners page; zero code changes to swap content.
 */

import { useQuery } from "@tanstack/react-query";
import type { MobileHomeBanner } from "@clickfy/types";
import { getSDK } from "@/lib/api";
import { rebaseAssetUrl } from "@/lib/rebase-url";
import { useLocale } from "next-intl";

const rebaseBanner = (b: MobileHomeBanner): MobileHomeBanner => {
  switch (b.kind) {
    case "image":
      return { ...b, image: { ...b.image, url: rebaseAssetUrl(b.image.url) } };
    case "image_slider":
      return { ...b, images: b.images.map((i) => ({ ...i, url: rebaseAssetUrl(i.url) })) };
    case "video":
      return {
        ...b,
        video: {
          ...b.video,
          hlsUrl: rebaseAssetUrl(b.video.hlsUrl),
          posterUrl: rebaseAssetUrl(b.video.posterUrl),
        },
      };
  }
};

export function useBanners() {
  const locale = useLocale();
  return useQuery({
    queryKey: ["catalog", "banners", locale],
    queryFn: async () => (await getSDK().catalog.listBanners()).map(rebaseBanner),
    staleTime: 5 * 60_000,
  });
}
