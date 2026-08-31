"use client";

/**
 * Right slide-over showing how one asset was generated — opened from
 * the tile's "Details" menu action. The provenance sections and the
 * action row are shared with the expanded lightbox's side panel via
 * `asset-detail.tsx`, so the two surfaces always show the same facts.
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { X } from "@phosphor-icons/react";
import type { AssetDetail } from "@clickfy/sdk";
import {
  AssetDetailActions,
  AssetDetailSections,
  useAssetDetail,
} from "@/components/studio/asset-detail";

export function AssetInfoPanel({
  projectId,
  assetId,
  onClose,
  onReuse,
  onDownload,
  favorited,
  onToggleFavorite,
  onTurnToVideo,
}: {
  projectId: string;
  assetId: string;
  onClose: () => void;
  /** Restore prompt + settings + references into the composer. */
  onReuse: (detail: AssetDetail) => void;
  onDownload: () => void;
  /**
   * Heart state is read from the studio's live asset cache rather than
   * the fetched detail, so toggling it here and toggling it on the tile
   * behind the panel never disagree.
   */
  favorited: boolean;
  onToggleFavorite: () => void;
  /** "Turn into video" — image assets only; absent hides the button. */
  onTurnToVideo?: (detail: AssetDetail) => void;
}) {
  const t = useTranslations("studio");
  const { detail, failed } = useAssetDetail(projectId, assetId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={t("assetInfo")}
        className="fixed inset-y-0 end-0 z-50 flex w-[min(400px,100vw)] flex-col border-s border-border bg-surface-1 shadow-2xl shadow-black/50"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{t("assetInfo")}</h2>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="nice-scroll flex-1 overflow-y-auto p-4">
          {/* Preview — the slide-over covers the tile it came from, so it
              carries its own thumbnail (the lightbox panel doesn't: the
              full-size media sits right next to it). */}
          <div className="overflow-hidden rounded-xl bg-surface-2">
            {detail ? (
              detail.kind === "video" ? (
                <video
                  src={detail.url}
                  poster={detail.posterUrl ?? undefined}
                  controls
                  playsInline
                  className="w-full"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={detail.url} alt="" className="w-full" />
              )
            ) : (
              <div className="aspect-square w-full animate-pulse bg-surface-3" />
            )}
          </div>

          <AssetDetailSections detail={detail} failed={failed} />
        </div>

        <footer className="border-t border-border p-3">
          <AssetDetailActions
            detail={detail}
            favorited={favorited}
            onToggleFavorite={onToggleFavorite}
            onDownload={onDownload}
            onReuse={onReuse}
            onTurnToVideo={onTurnToVideo}
          />
        </footer>
      </aside>
    </>
  );
}
