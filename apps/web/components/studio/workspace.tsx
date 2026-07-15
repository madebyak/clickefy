"use client";

import { Sparkle, ShareNetwork, DownloadSimple } from "@phosphor-icons/react";
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

const TEMPLATE_SUGGESTIONS = [
  { title: "Product on set", img: "/assets/16654be06b68b715118b40c4a9c2f7ff.jpg" },
  { title: "Editorial portrait", img: "/assets/0f8dad5a57467f8788f0e6be98924c2e.jpg" },
  { title: "Glass skin beauty", img: "/assets/9c80f14bd51b051bb029053c71e3bbb3.jpg" },
  { title: "Street fashion", img: "/assets/66c2bc99b2707c10686fdeaf0af29a0b.jpg" },
];

function EmptyState({ kind }: { kind: "image" | "video" }) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-col items-center py-14 text-center sm:py-20">
        <div className="grid size-14 place-items-center rounded-2xl bg-surface-3">
          <Sparkle weight="fill" className="size-6 text-brand-yellow" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Start a new project</h1>
        <p className="mt-2 max-w-md text-muted-foreground">
          Describe the {kind} you want in the bar below, or start from a template.
        </p>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Start from a template</h2>
          <a href="#" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Browse all →
          </a>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TEMPLATE_SUGGESTIONS.map((t) => (
            <a key={t.title} href="#" className="group block overflow-hidden rounded-xl bg-surface-2">
              <div className="aspect-[3/4] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={t.img}
                  alt={t.title}
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>
              <p className="truncate p-3 text-sm font-medium">{t.title}</p>
            </a>
          ))}
        </div>
      </div>
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
  return (
    <div>
      <div className="flex flex-col items-center py-8 text-center">
        <div className="grid size-12 place-items-center rounded-2xl bg-surface-3">
          <Sparkle weight="fill" className="size-5 text-brand-yellow" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{project.name}</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Click any asset to attach it to your prompt. Everything created here stays in this project.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          {project.assets.length} assets · updated {project.time.toLowerCase()}
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
            {activeProject ? activeProject.name : "New project"}
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
              <span className="hidden sm:inline">Download all</span>
            </button>
          )}
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-purple px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <ShareNetwork className="size-4" />
            <span className="hidden sm:inline">Share</span>
          </button>
        </div>
      </div>

      {/* scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 pb-44 pt-2 sm:px-6">
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
