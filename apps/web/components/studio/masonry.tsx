"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Info,
  DownloadSimple,
  X,
  Play,
  Check,
  ImageSquare,
  ArrowCounterClockwise,
  CircleNotch,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Asset } from "@/components/studio/studio-context";

function downloadAsset(a: Asset) {
  const el = document.createElement("a");
  el.href = a.src;
  el.download = a.src.split("/").pop() ?? "asset";
  document.body.appendChild(el);
  el.click();
  el.remove();
}

function OverlayButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/80"
    >
      {children}
    </button>
  );
}

/**
 * Pinterest-style masonry of typed assets (images + auto-looping videos).
 * Tiles have hover actions (expand / download); expand opens a lightbox.
 * onAssetClick attaches the asset to the prompt (the "Add as reference"
 * action); onAssetInfo opens the details panel. A plain tile click opens
 * the lightbox and is handled here.
 */
export function Masonry({
  assets,
  onAssetClick,
  onAssetInfo,
  onAssetReuse,
  reusingAssetId,
  selectedIds,
  onToggleSelect,
}: {
  assets: Asset[];
  onAssetClick?: (asset: Asset) => void;
  /** Opens the details slide-over for one asset. */
  onAssetInfo?: (asset: Asset) => void;
  /**
   * Restores this asset's generation setup into the composer — the same
   * action the details panel offers. The tile only holds an `Asset`, so
   * the parent fetches the full detail before applying it.
   */
  onAssetReuse?: (asset: Asset) => void;
  /** Asset id whose re-use fetch is in flight, if any. */
  reusingAssetId?: string | null;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
}) {
  const t = useTranslations("studio");
  const [lightbox, setLightbox] = useState<Asset | null>(null);
  // Reset per open so a second, slower image doesn't flash the previous one.
  const [loaded, setLoaded] = useState(false);
  const openLightbox = (a: Asset) => {
    setLoaded(false);
    setLightbox(a);
  };

  return (
    <>
      <div className="columns-2 gap-3 md:columns-3 2xl:columns-4">
        {assets.map((a) => (
          <div
            key={a.id}
            className={cn(
              "group relative mb-3 break-inside-avoid overflow-hidden rounded-xl bg-surface-2",
              selectedIds?.includes(a.id) && "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
          >
            <button
              type="button"
              onClick={() => openLightbox(a)}
              className="block w-full cursor-pointer outline-none"
              aria-label={t("expand")}
            >
              {a.type === "video" ? (
                <video
                  className="w-full"
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="metadata"
                  poster={a.poster}
                >
                  <source src={a.src} type="video/mp4" />
                </video>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.src} alt="" loading="lazy" className="w-full" />
              )}
            </button>

            {onToggleSelect && (
              <button
                type="button"
                aria-label={t("selectAsset")}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(a.id);
                }}
                className={cn(
                  "absolute start-2 top-2 z-10 grid size-6 place-items-center rounded-md border-2 transition-all",
                  selectedIds?.includes(a.id)
                    ? "border-primary bg-primary text-black opacity-100"
                    : "border-white/80 bg-black/25 text-transparent opacity-0 group-hover:opacity-100",
                )}
              >
                <Check weight="bold" className="size-3.5" />
              </button>
            )}

            {a.type === "video" && (
              // Shares the bottom-start corner with the "Add as reference"
              // button, so it yields on hover — it is a decorative
              // "this is a video" hint, and the hover state makes that
              // obvious anyway.
              <span className="pointer-events-none absolute start-2 bottom-2 grid size-6 place-items-center rounded-md bg-black/55 text-white opacity-100 backdrop-blur transition-opacity group-hover:opacity-0">
                <Play weight="fill" className="size-3" />
              </span>
            )}

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="absolute end-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              <OverlayButton
                label={t("assetInfo")}
                onClick={(e) => {
                  e.stopPropagation();
                  onAssetInfo?.(a);
                }}
              >
                <Info className="size-4" />
              </OverlayButton>
              <OverlayButton
                label={t("download")}
                onClick={(e) => {
                  e.stopPropagation();
                  downloadAsset(a);
                }}
              >
                <DownloadSimple className="size-4" />
              </OverlayButton>
            </div>

            {/* Bottom action bar. Both live in ONE row rather than at
                opposite corners: the masonry is columns-2 on mobile, so
                at ~170px of tile width two corner-anchored pills would
                overlap. Labels drop away on narrow tiles, leaving icons. */}
            {(onAssetClick || onAssetReuse) && (
              <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                {onAssetClick && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssetClick(a);
                    }}
                    className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-lg bg-black/70 px-2.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/85"
                  >
                    <ImageSquare className="size-3.5 shrink-0" />
                    <span className="hidden truncate sm:inline">{t("addAsReference")}</span>
                  </button>
                )}
                {onAssetReuse && (
                  <button
                    type="button"
                    disabled={reusingAssetId === a.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssetReuse(a);
                    }}
                    className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-lg bg-black/70 px-2.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/85 disabled:opacity-60"
                  >
                    {reusingAssetId === a.id ? (
                      <CircleNotch className="size-3.5 shrink-0 animate-spin" />
                    ) : (
                      <ArrowCounterClockwise className="size-3.5 shrink-0" />
                    )}
                    <span className="hidden truncate sm:inline">{t("reuseShort")}</span>
                  </button>
                )}
              </div>
            )}

          </div>
        ))}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="absolute end-4 top-4 flex gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                downloadAsset(lightbox);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-surface-3 px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              <DownloadSimple className="size-4" /> {t("download")}
            </button>
            <button
              type="button"
              aria-label={t("close")}
              onClick={() => setLightbox(null)}
              className="grid size-10 place-items-center rounded-lg bg-surface-3 text-foreground transition-colors hover:bg-surface-2"
            >
              <X className="size-5" />
            </button>
          </div>
          {lightbox.type === "video" ? (
            <video
              src={lightbox.src}
              poster={lightbox.poster}
              controls
              autoPlay
              loop
              playsInline
              className="max-h-[88vh] max-w-full rounded-lg"
              // Video keeps swallowing the click: the transport controls
              // live inside this box, so closing on it would make the
              // scrubber unusable.
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              {/* Full-resolution originals are large. Show the frame
                  immediately and swap it for the image once decoded,
                  rather than leaving the viewport empty. */}
              {!loaded && (
                <div className="size-64 animate-pulse rounded-lg bg-surface-2 sm:size-96" />
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.src}
                alt=""
                onLoad={() => setLoaded(true)}
                className={cn(
                  "max-h-[88vh] max-w-full rounded-lg object-contain",
                  loaded ? "block" : "hidden",
                )}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
