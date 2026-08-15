"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Sparkle,
  ShareNetwork,
  DownloadSimple,
  CircleNotch,
  Warning,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  useStudio,
  type Asset,
  type PendingGeneration,
  type StudioProject,
} from "@/components/studio/studio-context";
import { Masonry } from "@/components/studio/masonry";
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

function EmptyState({ kind }: { kind: "image" | "video" }) {
  const t = useTranslations("studio");
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-surface-3">
        <Sparkle weight="fill" className="size-6 text-brand-yellow" />
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
  selectedIds,
  onToggleSelect,
}: {
  project: StudioProject;
  assets: Asset[];
  pending: PendingGeneration[];
  onDismissPending: (jobId: string) => void;
  onAttach: (a: Asset) => void;
  onAssetInfo: (a: Asset) => void;
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
            <Sparkle weight="fill" className="size-5 text-brand-yellow" />
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
  } = useStudio();

  // Which asset the details slide-over is showing, if any.
  const [infoAssetId, setInfoAssetId] = useState<string | null>(null);
  const infoAsset = infoAssetId ? activeAssets.find((a) => a.id === infoAssetId) : undefined;

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
      {/* content header */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 text-sm">
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
        <div className="flex shrink-0 items-center gap-2">
          {!isEmpty && (
            <button
              type="button"
              onClick={downloadAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-surface-3 px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              <DownloadSimple className="size-4" />
              <span className="hidden sm:inline">{t("downloadAll")}</span>
            </button>
          )}
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-purple px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
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
              assets={activeAssets}
              pending={projectPending}
              onDismissPending={dismissPending}
              onAttach={addAttachment}
              onAssetInfo={(a) => setInfoAssetId(a.id)}
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
          onReuse={(detail) => {
            reuseSetup(detail);
            setInfoAssetId(null);
          }}
        />
      )}
    </main>
  );
}
