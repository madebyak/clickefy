"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Sparkle,
  ShareNetwork,
  DownloadSimple,
  CircleNotch,
  Warning,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { getSDK } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  useStudio,
  type Asset,
  type PendingGeneration,
  type StudioProject,
} from "@/components/studio/studio-context";
import { Masonry } from "@/components/studio/masonry";
import {
  CanvasToolbar,
  DEFAULT_GRID_SIZE,
  GRID_SIZES,
  type CanvasFilter,
  type GridSize,
} from "@/components/studio/canvas-toolbar";
import { AssetInfoPanel } from "@/components/studio/asset-info-panel";
import { SelectionBar } from "@/components/studio/selection-bar";
import { PromptBar } from "@/components/generate/prompt-bar";
import { useTimeLabel } from "@/lib/time-label";

function downloadAsset(a: Asset) {
  const el = document.createElement("a");
  el.href = a.src;
  el.download = a.src.split("/").pop() ?? "asset";
  document.body.appendChild(el);
  el.click();
  el.remove();
}

const GRID_SIZE_STORAGE_KEY = "clickefy:studio:gridSize";

/**
 * Grid density, remembered across sessions.
 *
 * Read lazily in an effect rather than in `useState`'s initializer: the
 * studio renders on the server first, and touching localStorage during
 * the initial render would hydrate a different tree than the server sent.
 */
function useGridSize(): [GridSize, (next: GridSize) => void] {
  const [gridSize, setGridSize] = useState<GridSize>(DEFAULT_GRID_SIZE);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(GRID_SIZE_STORAGE_KEY));
    if (GRID_SIZES.includes(stored as GridSize)) setGridSize(stored as GridSize);
  }, []);

  const update = useCallback((next: GridSize) => {
    setGridSize(next);
    try {
      window.localStorage.setItem(GRID_SIZE_STORAGE_KEY, String(next));
    } catch {
      // Private mode / quota. The setting still applies for this session.
    }
  }, []);

  return [gridSize, update];
}

function EmptyState({ kind }: { kind: "image" | "video" }) {
  const t = useTranslations("studio");
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-surface-3">
        <Sparkle weight="fill" className="size-6 text-brand-green" />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">{t("startNewProject")}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        {t(kind === "video" ? "emptyPromptVideo" : "emptyPromptImage")}
      </p>
    </div>
  );
}

/** In-flight / failed generation placeholders, docked above the masonry. */
function PendingStrip({
  pending,
  onDismiss,
}: {
  pending: PendingGeneration[];
  onDismiss: (jobId: string) => void;
}) {
  const t = useTranslations("studio");
  if (pending.length === 0) return null;
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {pending.map((p) => (
        <div
          key={p.jobId}
          className={cn(
            "relative flex aspect-square flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-surface-2 p-3 text-center",
            p.status !== "failed" && "animate-pulse",
          )}
        >
          {p.status === "failed" ? (
            <>
              <Warning weight="fill" className="size-6 text-status-red" />
              <p className="text-xs font-medium text-foreground">{t("generationFailed")}</p>
              {p.error && (
                <p className="line-clamp-2 text-[11px] text-muted-foreground">{p.error}</p>
              )}
              <button
                type="button"
                aria-label={t("dismiss")}
                onClick={() => onDismiss(p.jobId)}
                className="absolute end-2 top-2 grid size-6 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-black"
              >
                <X className="size-3.5" weight="bold" />
              </button>
            </>
          ) : (
            <>
              <CircleNotch className="size-6 animate-spin text-primary" />
              <p className="text-xs font-medium text-foreground">
                {p.status === "queued" ? t("queued") : t("generating")}
              </p>
              {p.stageLabel && (
                <p className="line-clamp-1 text-[11px] text-muted-foreground">{p.stageLabel}</p>
              )}
              {p.status === "processing" && typeof p.stageProgress === "number" && (
                <div className="absolute inset-x-3 bottom-3 h-1 overflow-hidden rounded-full bg-black/40">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.round(p.stageProgress * 100)}%` }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function ProjectView({
  project,
  assets,
  pending,
  onDismissPending,
  onAttach,
  onAssetInfo,
  onAssetReuse,
  onToggleFavorite,
  reusingAssetId,
  gridSize,
  selectedIds,
  onToggleSelect,
}: {
  project: StudioProject;
  assets: Asset[];
  pending: PendingGeneration[];
  onDismissPending: (jobId: string) => void;
  onAttach: (a: Asset) => void;
  onAssetInfo: (a: Asset) => void;
  onAssetReuse: (a: Asset) => void;
  onToggleFavorite: (a: Asset) => void;
  reusingAssetId: string | null;
  gridSize: GridSize;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
}) {
  const t = useTranslations("studio");
  const timeLabel = useTimeLabel();
  // The centred title block is an EMPTY STATE, not a header: it explains
  // what the canvas is for while there is nothing on it. The project name
  // and asset count also live in the top bar, so once the first
  // generation lands this is pure duplication pushing the work down the
  // page — the moment there is something to look at, the explanation goes.
  const showIntro = assets.length === 0 && pending.length === 0;
  return (
    <div>
      {showIntro && (
        <div className="flex flex-col items-center py-8 text-center">
          <div className="grid size-12 place-items-center rounded-2xl bg-surface-3">
            <Sparkle weight="fill" className="size-5 text-brand-green" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("projectHint")}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("assetsUpdated", { count: assets.length, time: timeLabel(project.updatedAt) })}
          </p>
        </div>
      )}
      <PendingStrip pending={pending} onDismiss={onDismissPending} />
      <Masonry
        assets={assets}
        onAssetClick={onAttach}
        onAssetInfo={onAssetInfo}
        onAssetReuse={onAssetReuse}
        onToggleFavorite={onToggleFavorite}
        reusingAssetId={reusingAssetId}
        gridSize={gridSize}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
      />
    </div>
  );
}

export function Workspace({ kind }: { kind: "image" | "video" }) {
  const t = useTranslations("studio");
  const {
    folders,
    activeProject,
    activeAssets,
    activeAssetsLoading,
    addAttachment,
    pending,
    dismissPending,
    selectedAssetIds,
    toggleAssetSelection,
    reuseSetup,
    setAssetsFavorite,
  } = useStudio();

  const [filter, setFilter] = useState<CanvasFilter>("all");
  const [gridSize, setGridSize] = useGridSize();

  const toggleFavorite = useCallback(
    (a: Asset) => setAssetsFavorite([a.id], !a.favorited),
    [setAssetsFavorite],
  );

  // Which asset the details slide-over is showing, if any.
  const [infoAssetId, setInfoAssetId] = useState<string | null>(null);
  const infoAsset = infoAssetId ? activeAssets.find((a) => a.id === infoAssetId) : undefined;

  // Re-use straight from a tile. The masonry only holds an `Asset`, but
  // restoring a setup needs the full provenance, so fetch it first — the
  // button shows a spinner for that hop rather than appearing inert.
  const [reusingAssetId, setReusingAssetId] = useState<string | null>(null);
  const handleReuse = useCallback(
    async (a: Asset) => {
      if (!activeProject || reusingAssetId) return;
      setReusingAssetId(a.id);
      try {
        const detail = await getSDK().projects.getAsset(activeProject.id, a.id);
        // Template-made assets carry no user prompt, so there is nothing
        // to restore — say so instead of silently doing nothing.
        if (!detail.generation?.prompt) {
          toast.error(t("reuseNothingToRestore"));
          return;
        }
        reuseSetup(detail);
      } catch {
        toast.error(t("detailsUnavailable"));
      } finally {
        setReusingAssetId(null);
      }
    },
    [activeProject, reusingAssetId, reuseSetup, t],
  );

  const kindCounts = useMemo(
    () => ({
      image: activeAssets.filter((a) => a.type === "image").length,
      video: activeAssets.filter((a) => a.type === "video").length,
      favorite: activeAssets.filter((a) => a.favorited).length,
    }),
    [activeAssets],
  );
  const visibleAssets = useMemo(() => {
    if (filter === "all") return activeAssets;
    // `favorite` is not an asset TYPE, so it cannot go through the same
    // comparison as image/video — it reads a different field entirely.
    if (filter === "favorite") return activeAssets.filter((a) => a.favorited);
    return activeAssets.filter((a) => a.type === filter);
  }, [activeAssets, filter]);

  // A filter that hides everything is a dead end the user can't diagnose
  // from an empty canvas — drop back to All when the thing they picked
  // stops existing (last video deleted, last favourite un-hearted,
  // project switched).
  useEffect(() => {
    if (filter !== "all" && kindCounts[filter] === 0) setFilter("all");
  }, [filter, kindCounts]);

  const projectPending = activeProject
    ? pending.filter((p) => p.projectId === activeProject.id)
    : [];
  const isEmpty =
    !activeProject ||
    (!activeAssetsLoading && activeAssets.length === 0 && projectPending.length === 0);

  const folderName = activeProject?.folderId
    ? folders.find((f) => f.id === activeProject.folderId)?.name
    : null;

  const downloadAll = () =>
    activeAssets.forEach((a, i) => setTimeout(() => downloadAsset(a), i * 250));

  return (
    <main className="relative flex min-w-0 flex-1 flex-col">
      {/* Content header. Three tracks rather than `justify-between`: the
          toolbar has to sit in the OPTICAL centre of the row, which a
          flex distribution can't guarantee once the project name on the
          start side changes length. */}
      <div className="flex shrink-0 items-center gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          {folderName && (
            <>
              <span className="hidden truncate text-muted-foreground sm:inline">{folderName}</span>
              <span className="hidden text-muted-foreground sm:inline">/</span>
            </>
          )}
          <span className="truncate font-medium">
            {activeProject ? activeProject.name : t("newProject")}
          </span>
        </div>
        {activeProject && (
          <div className="flex shrink-0 items-center justify-center">
            <CanvasToolbar
              filter={filter}
              onFilterChange={setFilter}
              gridSize={gridSize}
              onGridSizeChange={setGridSize}
              counts={kindCounts}
            />
          </div>
        )}

        <div className="flex flex-1 shrink-0 items-center justify-end gap-2">
          {!isEmpty && (
            <button
              type="button"
              onClick={downloadAll}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-surface-3 px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              <DownloadSimple className="size-4" />
              <span className="hidden sm:inline">{t("downloadAll")}</span>
            </button>
          )}
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-purple px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <ShareNetwork className="size-4" />
            <span className="hidden sm:inline">{t("share")}</span>
          </button>
        </div>
      </div>

      {/* scrollable content */}
      <div
        className={cn(
          "flex-1 overflow-y-auto px-4 pb-44 pt-2 sm:px-6",
          // Empty state fills the area and centers vertically; content scrolls from top.
          isEmpty && "flex flex-col",
        )}
      >
        {isEmpty ? (
          <EmptyState kind={kind} />
        ) : activeProject && activeAssetsLoading && activeAssets.length === 0 ? (
          <div className="grid grid-cols-2 gap-3 pt-6 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        ) : (
          activeProject && (
            <ProjectView
              project={activeProject}
              assets={visibleAssets}
              pending={projectPending}
              onDismissPending={dismissPending}
              onAttach={addAttachment}
              onAssetInfo={(a) => setInfoAssetId(a.id)}
              onAssetReuse={handleReuse}
              onToggleFavorite={toggleFavorite}
              reusingAssetId={reusingAssetId}
              gridSize={gridSize}
              selectedIds={selectedAssetIds}
              onToggleSelect={toggleAssetSelection}
            />
          )
        )}
      </div>

      {/* docked bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-12 sm:px-6">
        <div className="pointer-events-auto mx-auto max-w-4xl">
          <SelectionBar />
          <PromptBar kind={kind} />
        </div>
      </div>
      {activeProject && infoAssetId && (
        <AssetInfoPanel
          projectId={activeProject.id}
          assetId={infoAssetId}
          onClose={() => setInfoAssetId(null)}
          onDownload={() => infoAsset && downloadAsset(infoAsset)}
          favorited={infoAsset?.favorited ?? false}
          onToggleFavorite={() => infoAsset && toggleFavorite(infoAsset)}
          onReuse={(detail) => {
            reuseSetup(detail);
            setInfoAssetId(null);
          }}
        />
      )}
    </main>
  );
}
