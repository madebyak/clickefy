"use client";

import { useState } from "react";
import { ArrowsOutSimple, DownloadSimple, X, Play, Check } from "@phosphor-icons/react";
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
 * onAssetClick lets a parent do something (e.g. attach to the prompt).
 */
export function Masonry({
  assets,
  onAssetClick,
  selectedIds,
  onToggleSelect,
}: {
  assets: Asset[];
  onAssetClick?: (asset: Asset) => void;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
}) {
  const [lightbox, setLightbox] = useState<Asset | null>(null);

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
              onClick={() => onAssetClick?.(a)}
              className="block w-full cursor-pointer outline-none"
              aria-label="Use asset"
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
                aria-label="Select asset"
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
              <span className="pointer-events-none absolute start-2 bottom-2 grid size-6 place-items-center rounded-md bg-black/55 text-white backdrop-blur">
                <Play weight="fill" className="size-3" />
              </span>
            )}

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="absolute end-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              <OverlayButton
                label="Expand"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox(a);
                }}
              >
                <ArrowsOutSimple className="size-4" />
              </OverlayButton>
              <OverlayButton
                label="Download"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadAsset(a);
                }}
              >
                <DownloadSimple className="size-4" />
              </OverlayButton>
            </div>
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
              <DownloadSimple className="size-4" /> Download
            </button>
            <button
              type="button"
              aria-label="Close"
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
              className="max-h-[88vh] max-w-full rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.src}
              alt=""
              className="max-h-[88vh] max-w-full rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </>
  );
}
