"use client";

import { useRouter, usePathname } from "@/i18n/navigation";
import { Plus, FolderSimple, Heart, CaretUpDown } from "@phosphor-icons/react";
import { useStudio } from "@/components/studio/studio-context";
import { cn } from "@/lib/utils";

export function StudioSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { projects, activeProjectId, setActiveProject, createProject } = useStudio();

  const inBrowser = pathname === "/projects";

  const openProject = (id: string) => {
    setActiveProject(id);
    router.push("/create");
    onClose();
  };

  const newProject = () => {
    createProject(null);
    router.push("/create");
    onClose();
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={onClose} aria-hidden />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col bg-surface-1 p-3 transition-transform lg:static lg:z-auto lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          type="button"
          onClick={newProject}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-surface-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
        >
          <Plus className="size-4" weight="bold" />
          Create new project
        </button>

        <nav className="mt-4 space-y-1">
          <button
            type="button"
            onClick={() => {
              router.push("/projects");
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              inBrowser
                ? "bg-surface-3 text-foreground"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <FolderSimple className="size-[18px]" weight={inBrowser ? "fill" : "regular"} />
            My Projects
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <Heart className="size-[18px]" />
            Favorites
          </button>
        </nav>

        <div className="my-4 h-px bg-white/[0.06]" />

        <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent projects
        </p>
        <div className="mt-2 flex-1 space-y-1 overflow-y-auto">
          {projects.map((p) => {
            const cover = p.assets[0];
            const active = !inBrowser && activeProjectId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => openProject(p.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg p-2 text-start transition-colors",
                  active ? "bg-surface-3" : "hover:bg-surface-2",
                )}
              >
                <span className="size-9 shrink-0 overflow-hidden rounded-md bg-surface-3">
                  {cover &&
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover.poster ?? cover.src} alt="" className="size-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.assets.length} {p.assets.length === 1 ? "asset" : "assets"} · {p.time}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="mt-2 flex items-center gap-3 rounded-lg p-2 text-start transition-colors hover:bg-surface-2"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-purple text-xs font-semibold text-white">
            AK
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">Ahmed Kamal</span>
            <span className="block truncate text-xs text-muted-foreground">Pro plan</span>
          </span>
          <CaretUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </aside>
    </>
  );
}
