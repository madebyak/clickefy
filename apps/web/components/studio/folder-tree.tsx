"use client";

/**
 * "My Projects" in the sidebar — a collapsible tree of folders, each
 * expanding to the projects filed inside it.
 *
 * REPLACES a nav button that opened a full-page project browser. The page
 * still exists behind "Show all", but browsing your own folders should not
 * cost a navigation away from the canvas you are working on.
 *
 * NOTHING NEW IS PERSISTED. `folders`, `projects` and every mutation
 * (`createFolder`, `renameFolder`, `deleteFolder`, `moveProjectToFolder`)
 * already exist on the studio context and already write server-side. This
 * component is presentation over data that was always there.
 *
 * WHAT THE TREE DOES NOT DO, and why:
 *   - No nesting. `StudioFolder` is flat — no `parentId` — so a folder
 *     inside a folder is not expressible without a schema change.
 *   - No manual ordering. There is no position column, so folders are
 *     listed oldest-first, which at least keeps them from reshuffling
 *     under the cursor whenever one is renamed.
 *
 * Expansion state is intentionally in memory rather than localStorage.
 * Reading storage during render would mismatch the server-rendered HTML,
 * and the alternative — correcting it in an effect — makes the tree visibly
 * jump on every load. A folder you opened stays open for as long as you are
 * working, which is the span that matters.
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CaretDown,
  CaretRight,
  DotsThree,
  FolderSimple,
  Plus,
} from "@phosphor-icons/react";

import type { StudioFolder, StudioProject } from "@clickfy/sdk";
import { cn } from "@/lib/utils";
import { useStudio } from "@/components/studio/studio-context";

/** Folders shown before the list defers to the full browser. */
const VISIBLE_FOLDERS = 5;

export function FolderTree({
  onOpenProject,
  onShowAll,
}: {
  onOpenProject: (projectId: string) => void;
  onShowAll: () => void;
}) {
  const t = useTranslations("studio");
  const tp = useTranslations("projects");
  const { folders, projects, createFolder, renameFolder, deleteFolder } = useStudio();

  const [sectionOpen, setSectionOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const byFolder = useMemo(() => {
    const map = new Map<string, StudioProject[]>();
    for (const p of projects) {
      if (!p.folderId) continue;
      const list = map.get(p.folderId);
      if (list) list.push(p);
      else map.set(p.folderId, [p]);
    }
    return map;
  }, [projects]);

  const visible = folders.slice(0, VISIBLE_FOLDERS);
  const hidden = folders.length - visible.length;

  const toggleFolder = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /**
   * Create, then immediately rename. A folder called "New folder" that you
   * have to hunt for and rename separately is two steps where one will do,
   * and the second step is the one people skip — which is how you end up
   * with four folders all called "New folder".
   */
  const addFolder = async () => {
    if (creating) return;
    setCreating(true);
    setSectionOpen(true);
    const id = await createFolder(tp("defaultFolderName"));
    setCreating(false);
    if (id) setEditingId(id);
  };

  return (
    <div>
      <div className="flex items-center gap-1 rounded-lg pe-1 ps-3 text-muted-foreground">
        <button
          type="button"
          onClick={() => setSectionOpen((v) => !v)}
          aria-expanded={sectionOpen}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-start text-sm outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
        >
          {sectionOpen ? (
            <CaretDown className="size-3.5 shrink-0" weight="bold" />
          ) : (
            <CaretRight className="size-3.5 shrink-0 rtl:-scale-x-100" weight="bold" />
          )}
          <span className="truncate">{t("myProjects")}</span>
        </button>
        <button
          type="button"
          onClick={addFolder}
          disabled={creating}
          aria-label={tp("newFolder")}
          title={tp("newFolder")}
          className="grid size-7 shrink-0 place-items-center rounded-md outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          <Plus className="size-4" weight="bold" />
        </button>
      </div>

      {sectionOpen && (
        <div className="mt-0.5 space-y-0.5">
          {folders.length === 0 ? (
            // A folder is not required to use the product — projects work
            // fine unfiled — so this explains the button rather than
            // nagging about an empty state.
            <p className="px-3 py-1.5 text-xs leading-relaxed text-muted-foreground/70">
              {t("noFoldersHint")}
            </p>
          ) : (
            visible.map((f) => (
              <FolderNode
                key={f.id}
                folder={f}
                projects={byFolder.get(f.id) ?? []}
                open={expanded.has(f.id)}
                editing={editingId === f.id}
                onToggle={() => toggleFolder(f.id)}
                onStartRename={() => setEditingId(f.id)}
                onRename={(name) => {
                  setEditingId(null);
                  const trimmed = name.trim();
                  if (trimmed && trimmed !== f.name) renameFolder(f.id, trimmed);
                }}
                onCancelRename={() => setEditingId(null)}
                onDelete={() => void deleteFolder(f.id)}
                onOpenProject={onOpenProject}
              />
            ))
          )}

          {hidden > 0 && (
            <button
              type="button"
              onClick={onShowAll}
              className="w-full rounded-lg px-3 py-1.5 text-start text-xs text-muted-foreground outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t("showAllFolders", { count: hidden })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FolderNode({
  folder,
  projects,
  open,
  editing,
  onToggle,
  onStartRename,
  onRename,
  onCancelRename,
  onDelete,
  onOpenProject,
}: {
  folder: StudioFolder;
  projects: StudioProject[];
  open: boolean;
  editing: boolean;
  onToggle: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onOpenProject: (id: string) => void;
}) {
  const tp = useTranslations("projects");
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(folder.name);

  // Select the whole name on entry, so a freshly created folder is renamed
  // by typing rather than by clearing first.
  //
  // `useCallback` with no deps is load-bearing: an inline ref callback gets
  // a new identity every render, so React would detach and re-attach it —
  // re-selecting the text under the cursor on every keystroke.
  const focusInput = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-lg pe-1 ps-3 transition-colors",
          open ? "bg-surface-2/60" : "hover:bg-surface-2",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-start text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
        >
          <FolderSimple
            className="size-[18px] shrink-0"
            weight={open ? "fill" : "regular"}
          />
          {editing ? (
            <input
              ref={focusInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => onRename(draft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRename(draft);
                if (e.key === "Escape") {
                  setDraft(folder.name);
                  onCancelRename();
                }
              }}
              // The row is a button; without this a click to place the
              // caret would collapse the folder instead.
              onClick={(e) => e.stopPropagation()}
              className="w-full min-w-0 rounded bg-surface-1 px-1 py-0.5 text-sm text-foreground outline-none ring-1 ring-primary"
            />
          ) : (
            <span className="truncate">{folder.name}</span>
          )}
          {!editing && projects.length > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground/60">
              {projects.length}
            </span>
          )}
        </button>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={tp("folderOptions")}
            className={cn(
              "grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary",
              // Revealed on hover/focus so five folders are five names,
              // not five names and five buttons.
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
            )}
          >
            <DotsThree className="size-4" weight="bold" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
                aria-hidden
              />
              <div className="absolute end-0 top-8 z-50 w-40 overflow-hidden rounded-lg bg-surface-3 py-1 shadow-lg ring-1 ring-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDraft(folder.name);
                    onStartRename();
                  }}
                  className="block w-full px-3 py-1.5 text-start text-sm text-foreground transition-colors hover:bg-surface-2"
                >
                  {tp("renameAction")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className="block w-full px-3 py-1.5 text-start text-sm text-status-red transition-colors hover:bg-surface-2"
                >
                  {tp("deleteFolderAction")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {open && (
        <div className="ms-[26px] space-y-0.5 border-s border-border ps-2">
          {projects.length === 0 ? (
            <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground/70">
              {tp("emptyFolder")}
            </p>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProject(p.id)}
                className="block w-full truncate rounded-md px-2 py-1.5 text-start text-sm text-muted-foreground outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
              >
                {p.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
