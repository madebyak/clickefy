"use client";

import { useLocale, useTranslations } from "next-intl";

/**
 * Relative label for project/asset timestamps: "Just now" (<1h),
 * "Yesterday" (<48h), else a localized date. Mirrors mobile's
 * whenLabel behavior using the existing `time` message namespace.
 */
export function useTimeLabel() {
  const t = useTranslations("time");
  const locale = useLocale();
  return (iso: string) => {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const ageMs = Date.now() - then;
    if (ageMs < 60 * 60 * 1000) return t("justNow");
    if (ageMs < 48 * 60 * 60 * 1000) return t("yesterday");
    return new Date(iso).toLocaleDateString(locale);
  };
}
