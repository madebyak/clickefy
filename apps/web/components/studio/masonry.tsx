"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Info,
  DownloadSimple,
  DotsThree,
  Heart,
  X,
  Images,
  Play,
  Check,
  ImageSquare,
  ArrowCounterClockwise,
  CircleNotch,
  Trash,
  VideoCamera,
} from "@phosphor-icons/react";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { downloadAsset } from "@/lib/download-asset";
import { ASSET_DRAG_TYPE, type Asset } from "@/components/studio/studio-context";
import { DEFAULT_GRID_SIZE, type GridSize } from "@/components/studio/canvas-toolbar";
import {
  AssetDetailActions,
  AssetDetailSections,
  useAssetDetail,
} from "@/components/studio/asset-detail";
import { useToolsMaybe } from "@/components/tools/tools-context";

/**
 * Justified rows — the layout every serious media library converges on
 * (Google Photos, Flickr, Higgsfield): tiles in a row share ONE height
 * and are sized by their own aspect ratio so every row fills the width
 * edge to edge. Order reads left-to-right, row by row, exactly as the
 * newest-first list is sorted; nothing jumps columns as media loads
 * because the ratio comes from the asset record, not from the decoded
 * pixels.
 *
 * The previous grid was flex columns filled round-robin, which kept the
 * order but left ragged bottoms, uneven gutters and a lot of dead space
 * between tiles of different shapes.
 *
 * Density steps map to a TARGET row height expressed as a fraction of the
 * container width — so "how many tiles fit across" scales with the
 * viewport instead of being a fixed pixel size. Rows land within a few
 * percent of the target; the last row is never stretched.
 */
const ROW_HEIGHT_FRACTION: Record<GridSize, number> = {
  0: 0.42,
  1: 0.3,
  2: 0.22,
  3: 0.16,
};

/** Gutter in px per density — tight, the way a photo wall reads. */
const GAP_PX: Record<GridSize, number> = {
  0: 6,
  1: 5,
  2: 4,
  3: 3,
};

/**
 * Phones get taller rows than the fraction alone would give: a 0.16
 * fraction on a 380px screen is a 60px strip. Floor the row height so a
 * tile is always something you can see and hit.
 */
const MIN_ROW_HEIGHT_PX = 120;

/**
 * Keep pathological ratios from hijacking a row: a 21:9 banner next to a
 * 9:16 story still shares the row, but an extreme panorama would
 * otherwise squeeze its neighbours to slivers.
 */
const MIN_ASPECT = 0.45;
const MAX_ASPECT = 2.4;

function aspectOf(a: Asset): number {
  const ratio =
    a.width && a.height && a.height > 0
      ? a.width / a.height
      : a.type === "video"
        ? 16 / 9
        : 1;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, ratio));
}

type LaidOutTile = { asset: Asset; width: number; height: number };
type LaidOutRow = { key: string; tiles: LaidOutTile[]; height: number };

/**
 * Greedy row filler: add tiles until the row, scaled to fill the width,
 * would be no taller than the target, then close it. The classic
 * approach — no look-ahead, so very cheap, and the one-row-at-a-time
 * error is bounded by a single tile's aspect.
 */
function layoutRows(
  assets: Asset[],
  containerWidth: number,
  targetHeight: number,
  gap: number,
): LaidOutRow[] {
  const rows: LaidOutRow[] = [];
  let current: Asset[] = [];
  let aspectSum = 0;

  const close = (items: Asset[], height: number) => {
    rows.push({
      key: items.map((a) => a.id).join("|"),
      height,
      tiles: items.map((a) => ({ asset: a, width: aspectOf(a) * height, height })),
    });
  };

  for (const asset of assets) {
    current.push(asset);
    aspectSum += aspectOf(asset);
    const rowWidth = containerWidth - gap * (current.length - 1);
    const fitted = rowWidth / aspectSum;
    if (fitted <= targetHeight) {
      close(current, fitted);
      current = [];
      aspectSum = 0;
    }
  }
  if (current.length > 0) {
    // Last row: size at the target height and leave the remainder empty
    // rather than blowing two tiles up to fill the width.
    const rowWidth = containerWidth - gap * (current.length - 1);
    close(current, Math.min(targetHeight, rowWidth / aspectSum));
  }
  return rows;
}

/** Live width of the grid's container, so rows fit the actual viewport. */
function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
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
  onAssetDelete,
  onTurnToVideo,
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
  /**
   * Delete one asset from the tile menu. Absent hides the item — the
   * grid itself never decides whether deletion is available here.
   */
  onAssetDelete?: (asset: Asset) => void;
  /**
   * "Turn into video" from the expanded view — flips the composer to
   * video mode with this image as the start frame.
   */
  onTurnToVideo?: (asset: Asset) => void;
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
  const tools = useToolsMaybe();
  // Dense grids drop the button labels. The existing `sm:` breakpoint
  // only knows the VIEWPORT, so on a wide screen at maximum density it
  // would happily render "Add as reference" inside a 150px tile.
  const compactTiles = gridSize >= 2;
  const [lightbox, setLightbox] = useState<Asset | null>(null);
  const openLightbox = (a: Asset) => setLightbox(a);
  // The expanded view reads the LIVE row, not the click-time snapshot —
  // hearting from inside it must reflect on reopen, and an asset deleted
  // (or filtered away) under it closes the view instead of showing a
  // ghost.
  const liveLightbox = lightbox ? (assets.find((x) => x.id === lightbox.id) ?? null) : null;
  useEffect(() => {
    if (lightbox && !liveLightbox) setLightbox(null);
  }, [lightbox, liveLightbox]);

  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  const gap = GAP_PX[gridSize];
  const rows = useMemo(() => {
    if (containerWidth <= 0) return [];
    const target = Math.max(MIN_ROW_HEIGHT_PX, containerWidth * ROW_HEIGHT_FRACTION[gridSize]);
    return layoutRows(assets, containerWidth, target, gap);
  }, [assets, containerWidth, gridSize, gap]);

  const renderTile = ({ asset: a, width, height }: LaidOutTile) => (
          <div
            key={a.id}
            style={{ width, height }}
            draggable
            onDragStart={(e) => {
              // Toward the composer — see ASSET_DRAG_TYPE. The composer
              // validates against the selected model and explains any
              // refusal, so every tile is draggable, videos included.
              e.dataTransfer.setData(
                ASSET_DRAG_TYPE,
                JSON.stringify({ id: a.id, type: a.type, src: a.src }),
              );
              e.dataTransfer.effectAllowed = "copy";
            }}
            className={cn(
              "group relative shrink-0 overflow-hidden rounded-lg bg-surface-2 transition-all duration-200",
              selectedIds?.includes(a.id) && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              exitingIds?.includes(a.id) && "pointer-events-none scale-95 opacity-0",
            )}
          >
            <button
              type="button"
              onClick={() => openLightbox(a)}
              className="block size-full cursor-pointer outline-none"
              aria-label={t("expand")}
            >
              {a.type === "video" ? (
                <video
                  className="size-full object-cover"
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
                <img src={a.src} alt="" loading="lazy" className="size-full object-cover" />
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

              {/* Placed from My Assets rather than generated here. Its own
                  corner, and it does NOT fade on hover: this is the fact
                  that explains why the tile has no prompt and no Re-use, so
                  it must be readable exactly when someone goes looking for
                  them. */}
              {a.fromLibrary && (
                <span className="pointer-events-none absolute end-2 bottom-2 flex items-center gap-1 rounded-md bg-primary/85 px-1.5 py-1 text-[10px] font-semibold text-black backdrop-blur">
                  <Images weight="fill" className="size-3 shrink-0" />
                  {t("fromLibraryBadge")}
                </span>
              )}

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            {/* Idle favorited badge. The user still needs to see which of
                fifty tiles they saved WITHOUT hovering, but the corner
                slot belongs to the ⋯ menu — so the state is a badge that
                yields on hover (same pattern as the video badge below),
                and the heart CONTROL lives in the hover row. */}
            {a.favorited && (
              <span className="pointer-events-none absolute end-2 top-2 z-10 grid size-8 place-items-center rounded-lg bg-black/55 backdrop-blur transition-opacity group-hover:opacity-0">
                <Heart weight="fill" className="size-4 text-status-red" />
              </span>
            )}
            {/* Hover controls, ⋯ menu FIRST at the corner — it is the
                tile's front door (Details, Re-use, Delete live in it), so
                it gets the most reachable slot; download and heart follow
                inward. The menu portals out because the tile is
                `overflow-hidden` and would otherwise clip it. */}
            <div className="absolute end-2 top-2 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
                    {tools && a.type === "image" && (
                      <MenuItem
                        onClick={() => {
                          tools.openCameraAngle({ id: a.id, src: a.src });
                          close();
                        }}
                      >
                        <VideoCamera className="size-4 text-muted-foreground" />
                        {t("changeCameraAngle")}
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
                    {/* Destructive, so it sits last and fenced off — the
                        same optimistic delete the selection bar runs. */}
                    {onAssetDelete && (
                      <>
                        <MenuSeparator />
                        <MenuItem
                          onClick={() => {
                            onAssetDelete(a);
                            close();
                          }}
                        >
                          <Trash className="size-4 text-status-red" />
                          <span className="text-status-red">{t("deleteAsset")}</span>
                        </MenuItem>
                      </>
                    )}
                  </>
                )}
              </Menu>
            </div>
            {/* Download — one click for the single most common action on
                a finished render. Hover-only: it carries no idle state. */}
            <div className="absolute end-12 top-2 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
            {/* Heart control, innermost of the row (its idle state shows
                as the corner badge above). */}
            {onToggleFavorite && (
              <div className="absolute end-[5.5rem] top-2 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
  );

  return (
    <>
      {/* Justified rows — see ROW_HEIGHT_FRACTION. Each row is a flex
          line of explicitly sized tiles; the container's live width is
          what the rows were solved against, so they fit exactly. */}
      <div ref={containerRef} className="flex w-full flex-col" style={{ gap }}>
        {rows.map((row) => (
          <div key={row.key} className="flex" style={{ gap, height: row.height }}>
            {row.tiles.map(renderTile)}
          </div>
        ))}
      </div>

      {liveLightbox && (
        <ExpandedAsset
          asset={liveLightbox}
          onClose={() => setLightbox(null)}
          onToggleFavorite={onToggleFavorite}
          onAssetReuse={onAssetReuse}
          onTurnToVideo={onTurnToVideo}
        />
      )}
    </>
  );
}

/**
 * The expanded view: full-size media with a FIXED details panel beside
 * it — the same provenance the Details slide-over shows (prompt with
 * its own scrollbar, references, settings, actions), fetched on open
 * and shared via `asset-detail.tsx` so the two surfaces cannot drift.
 * On narrow screens the panel docks below the media instead.
 */
function ExpandedAsset({
  asset,
  onClose,
  onToggleFavorite,
  onAssetReuse,
  onTurnToVideo,
}: {
  asset: Asset;
  onClose: () => void;
  onToggleFavorite?: (asset: Asset) => void;
  onAssetReuse?: (asset: Asset) => void;
  onTurnToVideo?: (asset: Asset) => void;
}) {
  const t = useTranslations("studio");
  const { detail, failed } = useAssetDetail(asset.projectId, asset.id);
  // Reset per asset so a second, slower image doesn't flash the previous one.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [asset.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={t("assetInfo")}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 md:flex-row"
    >
      {/* Media stage — clicking the empty space closes; the media itself
          doesn't (a video's transport controls live inside its box). */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center p-4 md:p-8"
        onClick={onClose}
      >
        {asset.type === "video" ? (
          <video
            src={asset.src}
            poster={asset.poster}
            controls
            autoPlay
            loop
            playsInline
            className="max-h-full max-w-full rounded-lg"
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
              src={asset.src}
              alt=""
              onLoad={() => setLoaded(true)}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "max-h-full max-w-full rounded-lg object-contain",
                loaded ? "block" : "hidden",
              )}
            />
          </>
        )}
      </div>

      {/* Fixed details panel */}
      <aside className="flex max-h-[46vh] w-full shrink-0 flex-col border-t border-border bg-surface-1 md:max-h-none md:w-[380px] md:border-s md:border-t-0">
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
          <AssetDetailSections detail={detail} failed={failed} />
        </div>
        <footer className="border-t border-border p-3">
          <AssetDetailActions
            detail={detail}
            favorited={asset.favorited}
            onToggleFavorite={() => onToggleFavorite?.(asset)}
            onDownload={() => downloadAsset(asset)}
            onReuse={() => {
              // The grid's re-use flow re-fetches and restores into the
              // composer; close so the composer is visible when it lands.
              onAssetReuse?.(asset);
              onClose();
            }}
            onTurnToVideo={
              onTurnToVideo
                ? () => {
                    onTurnToVideo(asset);
                    onClose();
                  }
                : undefined
            }
          />
        </footer>
      </aside>
    </div>
  );
}
