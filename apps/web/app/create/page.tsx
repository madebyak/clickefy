"use client";

import { useRef, useState } from "react";
import { Sparkle, ShareNetwork, DownloadSimple } from "@phosphor-icons/react";
import { StudioTopbar } from "@/components/studio/studio-topbar";
import { StudioSidebar, type Project } from "@/components/studio/studio-sidebar";
import { Masonry } from "@/components/studio/masonry";
import { PromptBar } from "@/components/generate/prompt-bar";

const POOL = [
  "/assets/9c80f14bd51b051bb029053c71e3bbb3.jpg",
  "/assets/21a4d7e76d86558a6c1b63db2982edbd.jpg",
  "/assets/0f8dad5a57467f8788f0e6be98924c2e.jpg",
  "/assets/16654be06b68b715118b40c4a9c2f7ff.jpg",
  "/assets/987ac62f95b7292782498f28bea6e2e5.jpg",
  "/assets/1853e30e65039bdaca0f3b5d5a927a31.jpg",
  "/assets/19d64ae180f986f329e0427901e0a3b6.jpg",
  "/assets/44f6c9193c5fbad553a39365e643d325.jpg",
  "/assets/4a3759d212ca16933c5a0ef7d424b46e.jpg",
  "/assets/66c2bc99b2707c10686fdeaf0af29a0b.jpg",
  "/assets/9679583672ad21cc7486dbf5bf221444.jpg",
  "/assets/1ded17351c618f995413d16f71061a4e.jpg",
  "/assets/16ea40729954d9f7955c0aa18b5311a7.jpg",
  "/assets/425321aaa07c0244454cdab421f9dcf2-2.jpg",
  "/assets/9dc49668408f711f0a052b89dcdba229.jpg",
  "/assets/1772177693429-b8d6ddbe-824f-4e3e-a953-eebd2e05df47.png",
  "/assets/1772188591187-52f24a65-074f-4e7e-90b4-edd0ea0f6756.png",
  "/assets/1770284669759-acdd530e-27e4-41f5-9495-c992286a2783.png",
];

const INITIAL_PROJECTS: Project[] = [
  { id: "lavender", name: "Lavender skincare campaign", runs: 2, time: "Just now", images: POOL },
  { id: "summer", name: "Summer fashion concepts", runs: 2, time: "Yesterday", images: POOL.slice(0, 9) },
  { id: "coffee", name: "Coffee launch imagery", runs: 3, time: "Yesterday", images: POOL.slice(4, 13) },
  { id: "portrait", name: "Portrait lighting tests", runs: 4, time: "Yesterday", images: POOL.slice(2, 11) },
];

const TEMPLATE_SUGGESTIONS = [
  { title: "Product on set", img: POOL[3] },
  { title: "Editorial portrait", img: POOL[2] },
  { title: "Glass skin beauty", img: POOL[0] },
  { title: "Street fashion", img: POOL[9] },
];

function downloadImage(src: string, name?: string) {
  const a = document.createElement("a");
  a.href = src;
  a.download = name ?? src.split("/").pop() ?? "image";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ProjectView({ project }: { project: Project }) {
  return (
    <div>
      <div className="flex flex-col items-center py-8 text-center">
        <div className="grid size-12 place-items-center rounded-2xl bg-surface-3">
          <Sparkle weight="fill" className="size-5 text-brand-yellow" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{project.name}</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Everything created here stays inside this project — not in one endless feed.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Created today · {project.runs} runs · {project.images.length} assets
        </p>
      </div>
      <Masonry images={project.images} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-col items-center py-14 text-center sm:py-20">
        <div className="grid size-14 place-items-center rounded-2xl bg-surface-3">
          <Sparkle weight="fill" className="size-6 text-brand-yellow" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Start a new project</h1>
        <p className="mt-2 max-w-md text-muted-foreground">
          Describe what you want in the bar below, or start from a template.
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

export default function CreatePage() {
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [activeId, setActiveId] = useState<string>(INITIAL_PROJECTS[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const counter = useRef(1);

  const active = projects.find((p) => p.id === activeId) ?? null;
  const isEmpty = !active || active.images.length === 0;

  const newProject = () => {
    const id = `untitled-${counter.current++}`;
    setProjects((prev) => [
      { id, name: "Untitled project", runs: 0, time: "Just now", images: [] },
      ...prev,
    ]);
    setActiveId(id);
  };

  const downloadAll = () => {
    active?.images.forEach((src, i) =>
      setTimeout(() => downloadImage(src, `${active.id}-${i + 1}`), i * 250),
    );
  };

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <StudioTopbar onMenu={() => setSidebarOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <StudioSidebar
          projects={projects}
          activeId={activeId}
          onSelect={setActiveId}
          onNew={newProject}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* content header */}
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden truncate text-muted-foreground sm:inline">
                Moonwhale Campaigns
              </span>
              <span className="hidden text-muted-foreground sm:inline">/</span>
              <span className="truncate font-medium">{active ? active.name : "New project"}</span>
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
            {isEmpty ? <EmptyState /> : active && <ProjectView project={active} />}
          </div>

          {/* docked generate bar */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-12 sm:px-6">
            <div className="pointer-events-auto mx-auto max-w-4xl shadow-2xl shadow-black/60 [&>div]:rounded-2xl">
              <PromptBar />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
