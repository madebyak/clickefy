"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Info,
  DownloadSimple,
  DotsThree,
  Heart,
  X,
  Play,
  Check,
  ImageSquare,
  ArrowCounterClockwise,
  CircleNotch,
} from "@phosphor-icons/react";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import type { Asset } from "@/components/studio/studio-context";
import { DEFAULT_GRID_SIZE, type GridSize } from "@/components/studio/canvas-toolbar";

/**
 * Column counts per density step, largest tiles first.
 *
 * Written out as whole class strings because Tailwind scans source
 * statically — `columns-${n}` produces nothing at build time. Each step
 * also scales with the viewport, so "smallest" on a laptop is not the
 * same absolute tile size as "smallest" on a 4K display; the control
 * sets relative density, which is what the user is actually choosing.
 *
 * Below `md` every step is two columns: a phone has no room for a third,
 * and the toolbar hides the slider there for the same reason.
 */
const GRID_COLUMNS: Record<GridSize, string> = {
  0: "columns-2 md:columns-2 2xl:columns-3",
  1: "columns-2 md:columns-3 2xl:columns-4",
  2: "columns-2 md:columns-4 2xl:columns-6",
  3: "columns-3 md:columns-6 2xl:columns-8",
};

/** Gutters tighten as tiles shrink, so dense grids don't read as gappy. */
const GRID_GAP: Record<GridSize, string> = {
  0: "gap-4",
  1: "gap-3",
  2: "gap-2.5",
  3: "gap-2",
};

const TILE_GAP: Record<GridSize, string> = {
  0: "mb-4",
  1: "mb-3",
  2: "mb-2.5",
  3: "mb-2",
};

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
 * Tiles have hover actions (favorite / info / download); a plain tile
 * click opens the lightbox and is handled here. onAssetClick attaches
 * the asset to the prompt (the "Add as reference" action); onAssetInfo
 * opens the details panel.
 *
 * The heart is the one control that stays visible when it is ON — a
 * favorite the user can only see by hovering isn't a favorite they can
 * find. Everything else in the overlay appears on hover.
 */
export function Masonry({
  assets,
  onAssetClick,
  onAssetInfo,
  onAssetReuse,
  reusingAssetId,
  onToggleFavorite,
  showProjectName = false,
  exitingIds,
  gridSize = DEFAULT_GRID_SIZE,
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
  /** Heart / un-heart. Absent hides the control entirely. */
  onToggleFavorite?: (asset: Asset) => void;
  /** Cross-project grids (Favorites) label each tile with its project. */
  showProjectName?: boolean;
  /**
   * Tiles on their way out. A CSS-columns masonry can't animate a
   * reflow, but it can fade the departing tile before the parent drops
   * it — enough to show the click landed rather than blinking a hole in
   * the grid.
   */
  exitingIds?: string[];
  /** Grid density; see `GRID_COLUMNS`. */
  gridSize?: GridSize;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
}) {
  const t = useTranslations("studio");
  // Dense grids drop the button labels. The existing `sm:` breakpoint
  // only knows the VIEWPORT, so on a wide screen at maximum density it
  // would happily render "Add as reference" inside a 150px tile.
  const compactTiles = gridSize >= 2;
  const [lightbox, setLightbox] = useState<Asset | null>(null);
  // Reset per open so a second, slower image doesn't flash the previous one.
  const [loaded, setLoaded] = useState(false);
  const openLightbox = (a: Asset) => {
    setLoaded(false);
    setLightbox(a);
  };

  return (
    <>
      <div className={cn(GRID_COLUMNS[gridSize], GRID_GAP[gridSize])}>
        {assets.map((a) => (
          <div
            key={a.id}
            className={cn(
              "group relative break-inside-avoid overflow-hidden rounded-xl bg-surface-2 transition-all duration-200",
              TILE_GAP[gridSize],
              selectedIds?.includes(a.id) && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              exitingIds?.includes(a.id) && "pointer-events-none scale-95 opacity-0",
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

            {/* One badge for both hints — "this is a video" and, on the
                cross-project Favorites grid, which project it came from.
                They share the bottom-start corner with the action row, so
                the badge yields on hover; both are orientation, not
                controls, and the hover state makes the media type obvious
                anyway. */}
            {(a.type === "video" || (showProjectName && a.projectName)) && (
              <span className="pointer-events-none absolute start-2 bottom-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-md bg-black/55 px-1.5 py-1 text-[10px] font-medium text-white opacity-100 backdrop-blur transition-opacity group-hover:opacity-0">
                {a.type === "video" && <Play weight="fill" className="size-3 shrink-0" />}
                {showProjectName && a.projectName && (
                  <span className="truncate">{a.projectName}</span>
                )}
              </span>
            )}

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            {/* The heart sits outside the hover group on purpose: once an
                asset is favorited the filled icon has to stay on screen,
                or the grid gives the user no way to tell which of fifty
                tiles they already saved. */}
            {onToggleFavorite && (
              <div
                className={cn(
                  "absolute end-2 top-2 z-10 transition-opacity",
                  a.favorited ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                <OverlayButton
                  label={a.favorited ? t("unfavorite") : t("favorite")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(a);
                  }}
                >
                  <Heart
                    weight={a.favorited ? "fill" : "regular"}
                    className={cn("size-4", a.favorited && "text-status-red")}
                  />
                </OverlayButton>
              </div>
            )}
            {/* Everything the tile can do, in one menu. Details and
                Download used to be their own hover buttons; with the
                heart added that was three icons plus two pills fighting
                over a tile that can be 150px wide at high density. The
                menu portals out because the tile is `overflow-hidden`
                and would otherwise clip it. */}
            <div
              className={cn(
                "absolute top-2 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100",
                // Shift clear of the always-on heart when there is one.
                onToggleFavorite ? "end-12" : "end-2",
              )}
            >
              <Menu
                portal
                align="end"
                panelClassName="w-52"
                trigger={({ toggle }) => (
                  <OverlayButton
                    label={t("assetOptions")}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle();
                    }}
                  >
                    <DotsThree weight="bold" className="size-4" />
                  </OverlayButton>
                )}
              >
                {({ close }) => (
                  <>
                    {onToggleFavorite && (
                      <>
                        <MenuItem
                          onClick={() => {
                            onToggleFavorite(a);
                            close();
                          }}
                        >
                          <Heart
                            weight={a.favorited ? "fill" : "regular"}
                            className={cn(
                              "size-4",
                              a.favorited ? "text-status-red" : "text-muted-foreground",
                            )}
                          />
                          {a.favorited ? t("unfavorite") : t("favorite")}
                        </MenuItem>
                        <MenuSeparator />
                      </>
                    )}
                    {onAssetClick && a.type === "image" && (
                      <MenuItem
                        onClick={() => {
                          onAssetClick(a);
                          close();
                        }}
                      >
                        <ImageSquare className="size-4 text-muted-foreground" />
                        {t("addAsReference")}
                      </MenuItem>
                    )}
                    {onAssetReuse && (
                      <MenuItem
                        onClick={() => {
                          onAssetReuse(a);
                          close();
                        }}
                      >
                        <ArrowCounterClockwise className="size-4 text-muted-foreground" />
                        {t("reuse")}
                      </MenuItem>
                    )}
                    {onAssetInfo && (
                      <MenuItem
                        onClick={() => {
                          onAssetInfo(a);
                          close();
                        }}
                      >
                        <Info className="size-4 text-muted-foreground" />
                        {t("assetInfo")}
                      </MenuItem>
                    )}
                    <MenuItem
                      onClick={() => {
                        downloadAsset(a);
                        close();
                      }}
                    >
                      <DownloadSimple className="size-4 text-muted-foreground" />
                      {t("download")}
                    </MenuItem>
                  </>
                )}
              </Menu>
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
                    className={cn(
                      "inline-flex h-9 min-w-0 items-center gap-1.5 rounded-lg bg-black/70 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/85",
                      compactTiles ? "size-8 justify-center" : "px-2.5",
                    )}
                  >
                    <ImageSquare className="size-3.5 shrink-0" />
                    {!compactTiles && (
                      <span className="hidden truncate sm:inline">{t("addAsReference")}</span>
                    )}
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
                    className={cn(
                      "inline-flex h-9 min-w-0 items-center gap-1.5 rounded-lg bg-black/70 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/85 disabled:opacity-60",
                      compactTiles ? "size-8 justify-center" : "px-2.5",
                    )}
                  >
                    {reusingAssetId === a.id ? (
                      <CircleNotch className="size-3.5 shrink-0 animate-spin" />
                    ) : (
                      <ArrowCounterClockwise className="size-3.5 shrink-0" />
                    )}
                    {!compactTiles && (
                      <span className="hidden truncate sm:inline">{t("reuseShort")}</span>
                    )}
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
