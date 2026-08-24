"use client";

/**
 * Canvas controls for the studio grid: what you see, and how big.
 *
 * Sits in the centre of the workspace header. Both controls are view
 * state only — nothing here touches the server, so every interaction is
 * instant and nothing needs an optimistic path.
 *
 * Lucide rather than Phosphor for these two: the grid-density glyphs
 * (`Grid2x2` / `Grid3x3`) read the control's meaning at 14px in a way
 * Phosphor's squares-four family does not.
 */

import { useTranslations } from "next-intl";
import { Grid2x2, Grid3x3, Heart, Image as ImageIcon, Layers, Video } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What the grid is filtered to.
 *
 * `favorite` cuts across the other two rather than sitting beside them —
 * a favourited video is both — but it is presented as one more choice in
 * the same group because that is how people reach for it: "just show me
 * the good ones", not "show me the good ones, of which the videos".
 */
export type CanvasFilter = "all" | "image" | "video" | "favorite";

/**
 * Grid density, smallest index = largest tiles. Four steps is enough to
 * span "look at this one" to "see the whole shoot at once" without the
 * slider feeling vague.
 */
export const GRID_SIZES = [0, 1, 2, 3] as const;
export type GridSize = (typeof GRID_SIZES)[number];
export const DEFAULT_GRID_SIZE: GridSize = 1;

function FilterButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
        active
          ? "bg-surface-1 text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

export function CanvasToolbar({
  filter,
  onFilterChange,
  gridSize,
  onGridSizeChange,
  counts,
}: {
  filter: CanvasFilter;
  onFilterChange: (next: CanvasFilter) => void;
  gridSize: GridSize;
  onGridSizeChange: (next: GridSize) => void;
  /** Drives which filters are worth offering — see below. */
  counts: { image: number; video: number; favorite: number };
}) {
  const t = useTranslations("studio");

  // A project of nothing but images has no use for an Images/Videos
  // toggle — it would be three buttons where two are always empty. Show
  // those only once the canvas actually holds both kinds.
  const showKinds = counts.image > 0 && counts.video > 0;

  // Favourites are gated SEPARATELY, and this is the point of the split:
  // the project that most needs a favourites filter is a hundred images
  // from one shoot, which has no video at all. Gating favourites behind
  // `showKinds` would have hidden it in exactly that case.
  const showFavorites = counts.favorite > 0;

  const showFilter = showKinds || showFavorites;
  const showSize = counts.image + counts.video > 0;
  if (!showFilter && !showSize) return null;

  return (
    <div className="flex items-center gap-2">
      {showFilter && (
        <div
          role="radiogroup"
          aria-label={t("filterAssets")}
          className="flex items-center gap-0.5 rounded-lg bg-surface-3 p-0.5"
        >
          <FilterButton
            active={filter === "all"}
            label={t("filterAll")}
            onClick={() => onFilterChange("all")}
          >
            <Layers className="size-3.5 shrink-0" strokeWidth={2} />
          </FilterButton>
          {showKinds && (
            <>
              <FilterButton
                active={filter === "image"}
                label={t("filterImages")}
                onClick={() => onFilterChange("image")}
              >
                <ImageIcon className="size-3.5 shrink-0" strokeWidth={2} />
              </FilterButton>
              <FilterButton
                active={filter === "video"}
                label={t("filterVideos")}
                onClick={() => onFilterChange("video")}
              >
                <Video className="size-3.5 shrink-0" strokeWidth={2} />
              </FilterButton>
            </>
          )}
          {showFavorites && (
            <FilterButton
              active={filter === "favorite"}
              label={t("filterFavorites")}
              onClick={() => onFilterChange("favorite")}
            >
              <Heart
                className="size-3.5 shrink-0"
                strokeWidth={2}
                fill={filter === "favorite" ? "currentColor" : "none"}
              />
            </FilterButton>
          )}
        </div>
      )}

      {/* Density. Hidden on small screens: below `md` the grid is two
          columns wide whatever the setting, so the control would be a
          slider that visibly does nothing. */}
      {showSize && (
        <div className="hidden items-center gap-2 rounded-lg bg-surface-3 px-2.5 py-1.5 md:flex">
          <Grid2x2 className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
          <input
            type="range"
            min={0}
            max={GRID_SIZES.length - 1}
            step={1}
            value={gridSize}
            aria-label={t("gridSize")}
            onChange={(e) => onGridSizeChange(Number(e.target.value) as GridSize)}
            className="studio-range h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/15 outline-none"
          />
          <Grid3x3 className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
        </div>
      )}
    </div>
  );
}
