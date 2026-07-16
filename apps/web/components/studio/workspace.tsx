"use client";

import { useTranslations } from "next-intl";
import { Sparkle, ShareNetwork, DownloadSimple } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useStudio, type Asset, type Project } from "@/components/studio/studio-context";
import { Masonry } from "@/components/studio/masonry";
import { SelectionBar } from "@/components/studio/selection-bar";
import { PromptBar } from "@/components/generate/prompt-bar";

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

function ProjectView({
  project,
  onAttach,
  selectedIds,
  onToggleSelect,
}: {
  project: Project;
  onAttach: (a: Asset) => void;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
}) {
  const t = useTranslations("studio");
  const tt = useTranslations("time");
  const timeLabel =
    project.time === "Just now"
      ? tt("justNow")
      : project.time === "Yesterday"
        ? tt("yesterday")
        : project.time;
  return (
    <div>
      <div className="flex flex-col items-center py-8 text-center">
        <div className="grid size-12 place-items-center rounded-2xl bg-surface-3">
          <Sparkle weight="fill" className="size-5 text-brand-yellow" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{project.name}</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("projectHint")}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("assetsUpdated", { count: project.assets.length, time: timeLabel })}
        </p>
      </div>
      <Masonry
        assets={project.assets}
        onAssetClick={onAttach}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
      />
    </div>
  );
}

export function Workspace({ kind }: { kind: "image" | "video" }) {
  const t = useTranslations("studio");
  const {
    activeProject,
    attachments,
    addAttachment,
    removeAttachment,
    selectedAssetIds,
    toggleAssetSelection,
  } = useStudio();

  const isEmpty = !activeProject || activeProject.assets.length === 0;

  const downloadAll = () =>
    activeProject?.assets.forEach((a, i) => setTimeout(() => downloadAsset(a), i * 250));

  return (
    <main className="relative flex min-w-0 flex-1 flex-col">
      {/* content header */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="hidden truncate text-muted-foreground sm:inline">Moonwhale Campaigns</span>
          <span className="hidden text-muted-foreground sm:inline">/</span>
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
        ) : (
          activeProject && (
            <ProjectView
              project={activeProject}
              onAttach={addAttachment}
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
          <PromptBar kind={kind} attachments={attachments} onRemoveAttachment={removeAttachment} />
        </div>
      </div>
    </main>
  );
}
