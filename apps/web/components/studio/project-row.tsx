"use client";

/**
 * A project row in the studio sidebar, with its hover action menu.
 *
 * Lives in its own file because the menu carries three sub-views
 * (thumbnail picker, folder list, delete confirmation) and inlining that
 * would have doubled the length of the sidebar for one list item.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  DotsThree,
  PencilSimple,
  ImageSquare,
  FolderSimple,
  Trash,
  CaretLeft,
  Check,
} from "@phosphor-icons/react";
import { getSDK } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTimeLabel } from "@/lib/time-label";
import type { StudioProject, StudioFolder } from "@/components/studio/studio-context";

type Asset = { id: string; kind: "image" | "video"; url: string };

/** Which panel the menu is showing. */
type View = "root" | "thumbnail" | "folder" | "confirmDelete";

function Item({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/5",
        danger ? "text-status-red" : "text-foreground",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

export function ProjectRow({
  project,
  folders,
  active,
  onOpen,
  onRename,
  onMoveToFolder,
  onSetCover,
  onDelete,
}: {
  project: StudioProject;
  folders: StudioFolder[];
  active: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onMoveToFolder: (folderId: string | null) => void;
  onSetCover: (assetId: string | null) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("studio");
  const timeLabel = useTimeLabel();
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<View>("root");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click / Escape, and always reopen at the root view
  // so the menu never resumes mid-flow on a later open.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) setView("root");
  }, [menuOpen]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Assets are fetched only when the thumbnail picker is opened — a
  // sidebar of ten projects must not fire ten asset queries on mount.
  useEffect(() => {
    if (view !== "thumbnail" || assets !== null) return;
    let cancelled = false;
    getSDK()
      .projects.listAssets(project.id, { limit: 24 })
      .then((r) => {
        if (!cancelled) {
          setAssets(
            r.items.map((a) => ({ id: a.id, kind: a.kind, url: a.posterUrl ?? a.url })),
          );
        }
      })
      .catch(() => !cancelled && setAssets([]));
    return () => {
      cancelled = true;
    };
  }, [view, assets, project.id]);

  const commitRename = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== project.name) onRename(next);
    else setDraft(project.name);
  };

  return (
    <div ref={wrapRef} className="group/row relative">
      <div
        className={cn(
          "flex w-full items-center gap-3 rounded-lg p-2 transition-colors",
          active ? "bg-surface-3" : "hover:bg-surface-2",
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          disabled={editing}
          className="flex min-w-0 flex-1 items-center gap-3 text-start outline-none"
        >
          <span className="size-9 shrink-0 overflow-hidden rounded-md bg-surface-3">
            {project.cover &&
              (project.cover.kind === "video" ? (
                <video
                  src={project.cover.url}
                  muted
                  playsInline
                  preload="metadata"
                  className="size-full object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={project.cover.url} alt="" className="size-full object-cover" />
              ))}
          </span>
          <span className="min-w-0 flex-1">
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    setDraft(project.name);
                    setEditing(false);
                  }
                }}
                // The row is a button; without this a click to place the
                // caret would open the project instead.
                onClick={(e) => e.stopPropagation()}
                className="w-full rounded bg-surface-1 px-1 py-0.5 text-sm font-medium text-foreground outline-none ring-1 ring-primary"
              />
            ) : (
              <span className="block truncate text-sm font-medium">{project.name}</span>
            )}
            <span className="block truncate text-xs text-muted-foreground">
              {t("assets", { count: project.assetCount })} · {timeLabel(project.updatedAt)}
            </span>
          </span>
        </button>

        <button
          type="button"
          aria-label={t("projectActions")}
          onClick={() => setMenuOpen((o) => !o)}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-all hover:bg-white/10 hover:text-foreground focus-visible:opacity-100",
            // Pointer-only reveal would strand touch users, so the button
            // is always present on small screens.
            menuOpen ? "opacity-100" : "opacity-0 max-lg:opacity-100 group-hover/row:opacity-100",
          )}
        >
          <DotsThree weight="bold" className="size-4" />
        </button>
      </div>

      {menuOpen && (
        <div className="absolute end-2 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-surface-3 p-1.5 shadow-2xl shadow-black/50">
          {view === "root" && (
            <>
              <Item
                icon={<PencilSimple className="size-4" />}
                onClick={() => {
                  setDraft(project.name);
                  setEditing(true);
                  setMenuOpen(false);
                }}
              >
                {t("rename")}
              </Item>
              <Item
                icon={<ImageSquare className="size-4" />}
                onClick={() => setView("thumbnail")}
              >
                {t("changeThumbnail")}
              </Item>
              <Item icon={<FolderSimple className="size-4" />} onClick={() => setView("folder")}>
                {t("moveToFolder")}
              </Item>
              <div className="my-1 h-px bg-white/[0.06]" />
              <Item
                icon={<Trash className="size-4" />}
                danger
                onClick={() => setView("confirmDelete")}
              >
                {t("deleteProject")}
              </Item>
            </>
          )}

          {view === "thumbnail" && (
            <>
              <button
                type="button"
                onClick={() => setView("root")}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground outline-none hover:text-foreground"
              >
                <CaretLeft className="size-3" />
                {t("chooseThumbnail")}
              </button>
              {assets === null ? (
                <div className="grid grid-cols-4 gap-1.5 p-1.5">
                  {Array.from({ length: 8 }, (_, i) => (
                    <span key={i} className="aspect-square animate-pulse rounded bg-surface-2" />
                  ))}
                </div>
              ) : assets.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {t("noAssetsForThumbnail")}
                </p>
              ) : (
                <>
                  <div className="grid max-h-52 grid-cols-4 gap-1.5 overflow-y-auto p-1.5">
                    {assets.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          onSetCover(a.id);
                          setMenuOpen(false);
                        }}
                        className="aspect-square overflow-hidden rounded bg-surface-2 outline-none ring-primary transition-[box-shadow] hover:ring-2 focus-visible:ring-2"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.url} alt="" className="size-full object-cover" />
                      </button>
                    ))}
                  </div>
                  <Item
                    icon={<Check className="size-4" />}
                    onClick={() => {
                      onSetCover(null);
                      setMenuOpen(false);
                    }}
                  >
                    {t("resetThumbnail")}
                  </Item>
                </>
              )}
            </>
          )}

          {view === "folder" && (
            <>
              <button
                type="button"
                onClick={() => setView("root")}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground outline-none hover:text-foreground"
              >
                <CaretLeft className="size-3" />
                {t("moveToFolder")}
              </button>
              <div className="max-h-52 overflow-y-auto">
                <Item
                  icon={<FolderSimple className="size-4 opacity-40" />}
                  onClick={() => {
                    onMoveToFolder(null);
                    setMenuOpen(false);
                  }}
                >
                  {t("noFolder")}
                </Item>
                {folders.map((f) => (
                  <Item
                    key={f.id}
                    icon={<FolderSimple className="size-4" />}
                    onClick={() => {
                      onMoveToFolder(f.id);
                      setMenuOpen(false);
                    }}
                  >
                    {f.name}
                  </Item>
                ))}
              </div>
            </>
          )}

          {view === "confirmDelete" && (
            <>
              <button
                type="button"
                onClick={() => setView("root")}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground outline-none hover:text-foreground"
              >
                <CaretLeft className="size-3" />
                {t("back")}
              </button>
              {/* Deleting a project takes its assets with it, so this is
                  a two-step action rather than a single menu click. */}
              <Item
                icon={<Trash className="size-4" />}
                danger
                onClick={() => {
                  onDelete();
                  setMenuOpen(false);
                }}
              >
                {t("confirmDeleteProject")}
              </Item>
            </>
          )}
        </div>
      )}
    </div>
  );
}
