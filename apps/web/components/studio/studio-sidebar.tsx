"use client";

import { Plus, FolderSimple, Heart, CaretUpDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export type Project = {
  id: string;
  name: string;
  runs: number;
  time: string;
  images: string[];
};

function NavItem({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof Plus;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      <Icon className="size-[18px]" weight={active ? "fill" : "regular"} />
      {label}
    </button>
  );
}

export function StudioSidebar({
  projects,
  activeId,
  onSelect,
  onNew,
  open,
  onClose,
}: {
  projects: Project[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  open: boolean;
  onClose: () => void;
}) {
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
          onClick={() => {
            onNew();
            onClose();
          }}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-surface-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
        >
          <Plus className="size-4" weight="bold" />
          Create new project
        </button>

        <nav className="mt-4 space-y-1">
          <NavItem icon={FolderSimple} label="My Projects" active />
          <NavItem icon={Heart} label="Favorites" />
        </nav>

        <div className="my-4 h-px bg-white/[0.06]" />

        <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent projects
        </p>
        <div className="mt-2 flex-1 space-y-1 overflow-y-auto">
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect(p.id);
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg p-2 text-start transition-colors",
                activeId === p.id ? "bg-surface-3" : "hover:bg-surface-2",
              )}
            >
              <span className="size-9 shrink-0 overflow-hidden rounded-md bg-surface-3">
                {p.images[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.images[0]} alt="" className="size-full object-cover" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {p.runs} {p.runs === 1 ? "run" : "runs"} · {p.time}
                </span>
              </span>
            </button>
          ))}
        </div>

        {/* profile */}
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
