"use client";

/**
 * "My Projects" in the sidebar — a collapsible tree of folders, each
 * expanding to the projects filed inside it.
 *
 * REPLACES a nav button that opened a full-page project browser. The page
 * still exists behind "Show all", but browsing your own folders should not
 * cost a navigation away from the canvas you are working on.
 *
 * THREE LEVELS, enforced by the database (migration 0036) rather than by
 * this component: a composite foreign key ties every folder to a parent
 * exactly one level shallower, so a fourth level — and every cycle — is
 * unrepresentable however the API is called. The UI hides the "New
 * sub-folder" action at the bottom level because a control that always
 * fails is worse than no control, not because hiding it is what stops the
 * write.
 *
 * PROJECTS INSIDE A FOLDER ARE FULL `ProjectRow`s — same thumbnail, same
 * action menu as the Recent Projects list below. They used to be bare text
 * buttons, which meant a project you filed away could no longer be
 * renamed, re-covered, moved back out or deleted without first finding it
 * somewhere else. Filing something should not take away what you can do
 * with it.
 *
 * WHAT THE TREE STILL DOES NOT DO: manual ordering. There is no position
 * column, so folders arrive newest-first from the API — which at least
 * means a folder you just created is at the top, where you are looking.
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
  FolderPlus,
  FolderSimple,
  Plus,
} from "@phosphor-icons/react";

import type { StudioFolder, StudioProject } from "@clickfy/sdk";
import { cn } from "@/lib/utils";
import { foldersInTreeOrder } from "@/lib/folder-order";
import { useStudio } from "@/components/studio/studio-context";
import { ProjectRow } from "@/components/studio/project-row";

/** Top-level folders shown before the list defers to the full browser. */
const VISIBLE_FOLDERS = 5;

/** Deepest folder level. Matches the CHECK constraint in migration 0036. */
const MAX_DEPTH = 2;

/**
 * Connected wrapper. Everything below is a pure view over props, which is
 * what lets the tree be rendered — and looked at — outside the auth-gated
 * studio it normally lives in. A bug reported as "projects do not appear
 * inside folders" is not one you want to debug by reasoning alone.
 */
export function FolderTree(props: {
  onOpenProject: (projectId: string) => void;
  onShowAll: () => void;
}) {
  const {
    folders,
    projects,
    activeProjectId,
    createFolder,
    renameFolder,
    deleteFolder,
    renameProject,
    moveProjectToFolder,
    setProjectCover,
    deleteProject,
  } = useStudio();
  return (
    <FolderTreeView
      {...props}
      folders={folders}
      projects={projects}
      activeProjectId={activeProjectId}
      onCreateFolder={createFolder}
      onRenameFolder={renameFolder}
      onDeleteFolder={deleteFolder}
      onRenameProject={renameProject}
      onMoveProject={moveProjectToFolder}
      onSetProjectCover={setProjectCover}
      onDeleteProject={(id) => void deleteProject(id)}
    />
  );
}

/** Everything a node needs, bundled so recursion stays one prop deep. */
interface TreeCtx {
  folders: StudioFolder[];
  childrenOf: Map<string, StudioFolder[]>;
  byFolder: Map<string, StudioProject[]>;
  expanded: Set<string>;
  editingId: string | null;
  activeProjectId: string | null;
  toggle: (id: string) => void;
  startRename: (id: string) => void;
  commitRename: (folder: StudioFolder, name: string) => void;
  cancelRename: () => void;
  removeFolder: (id: string) => void;
  addSubfolder: (parentId: string) => void;
  openProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  moveProject: (id: string, folderId: string | null) => void;
  setCover: (id: string, assetId: string | null) => void;
  removeProject: (id: string) => void;
}

export function FolderTreeView({
  folders,
  projects,
  activeProjectId = null,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameProject,
  onMoveProject,
  onSetProjectCover,
  onDeleteProject,
  onOpenProject,
  onShowAll,
}: {
  folders: StudioFolder[];
  projects: StudioProject[];
  activeProjectId?: string | null;
  onCreateFolder: (name: string, parentId?: string | null) => Promise<string | null>;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onMoveProject: (projectId: string, folderId: string | null) => void;
  onSetProjectCover: (projectId: string, assetId: string | null) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
  onShowAll: () => void;
}) {
  const t = useTranslations("studio");
  const tp = useTranslations("projects");

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

  const childrenOf = useMemo(() => {
    const map = new Map<string, StudioFolder[]>();
    for (const f of folders) {
      if (!f.parentId) continue;
      const list = map.get(f.parentId);
      if (list) list.push(f);
      else map.set(f.parentId, [f]);
    }
    return map;
  }, [folders]);

  /**
   * Only ROOTS count against the visible limit. Counting sub-folders too
   * would let one folder you happened to expand push its own siblings
   * behind "Show all".
   */
  const roots = useMemo(() => folders.filter((f) => !f.parentId), [folders]);
  const visible = roots.slice(0, VISIBLE_FOLDERS);
  const hidden = roots.length - visible.length;

  /** Ordered for the "move to folder" menu: parents before their children. */
  const ordered = useMemo(() => foldersInTreeOrder(folders), [folders]);

  const toggle = useCallback(
    (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  /**
   * Create, then immediately rename. A folder called "New folder" that you
   * have to hunt for and rename separately is two steps where one will do,
   * and the second step is the one people skip — which is how you end up
   * with four folders all called "New folder".
   */
  const addFolder = useCallback(
    async (parentId?: string) => {
      if (creating) return;
      setCreating(true);
      setSectionOpen(true);
      // Open the parent BEFORE the request: a sub-folder created into a
      // collapsed folder would land in rename mode somewhere invisible,
      // and the rename would commit on the first outside click.
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      const id = await onCreateFolder(tp("defaultFolderName"), parentId ?? null);
      setCreating(false);
      if (id) setEditingId(id);
    },
    [creating, onCreateFolder, tp],
  );

  const ctx: TreeCtx = {
    folders: ordered,
    childrenOf,
    byFolder,
    expanded,
    editingId,
    activeProjectId,
    toggle,
    startRename: setEditingId,
    commitRename: (folder, name) => {
      setEditingId(null);
      const trimmed = name.trim();
      if (trimmed && trimmed !== folder.name) onRenameFolder(folder.id, trimmed);
    },
    cancelRename: () => setEditingId(null),
    removeFolder: onDeleteFolder,
    addSubfolder: (parentId) => void addFolder(parentId),
    openProject: onOpenProject,
    renameProject: onRenameProject,
    moveProject: onMoveProject,
    setCover: onSetProjectCover,
    removeProject: onDeleteProject,
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
          onClick={() => void addFolder()}
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
          {roots.length === 0 ? (
            // A folder is not required to use the product — projects work
            // fine unfiled — so this explains the button rather than
            // nagging about an empty state.
            <p className="px-3 py-1.5 text-xs leading-relaxed text-muted-foreground/70">
              {t("noFoldersHint")}
            </p>
          ) : (
            visible.map((f) => <FolderNode key={f.id} folder={f} ctx={ctx} />)
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

function FolderNode({ folder, ctx }: { folder: StudioFolder; ctx: TreeCtx }) {
  const tp = useTranslations("projects");
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(folder.name);

  const open = ctx.expanded.has(folder.id);
  const editing = ctx.editingId === folder.id;
  const children = ctx.childrenOf.get(folder.id) ?? [];
  const projects = ctx.byFolder.get(folder.id) ?? [];
  const canNest = folder.depth < MAX_DEPTH;

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

  /** Caret + folder icon, identical in both the editing and resting rows. */
  const leading = (
    <>
      {open ? (
        <CaretDown className="size-3 shrink-0 opacity-70" weight="bold" />
      ) : (
        <CaretRight className="size-3 shrink-0 opacity-70 rtl:-scale-x-100" weight="bold" />
      )}
      <FolderSimple className="size-[17px] shrink-0" weight={open ? "fill" : "regular"} />
    </>
  );

  const childCount = children.length + projects.length;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-lg pe-1 ps-3 transition-colors",
          open ? "bg-surface-2/60" : "hover:bg-surface-2",
        )}
      >
        {editing ? (
          // NOT inside the row button while renaming. A <button> is
          // activated by Space, so an <input> nested in one commits the
          // name and toggles the folder the moment you type a space —
          // "Test Folder" was impossible to type.
          <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-sm text-muted-foreground">
            {leading}
            <input
              ref={focusInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => ctx.commitRename(folder, draft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ctx.commitRename(folder, draft);
                if (e.key === "Escape") {
                  setDraft(folder.name);
                  ctx.cancelRename();
                }
              }}
              className="w-full min-w-0 rounded bg-surface-1 px-1 py-0.5 text-sm text-foreground outline-none ring-1 ring-primary"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => ctx.toggle(folder.id)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-start text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
          >
            {leading}
            <span className="truncate">{folder.name}</span>
            {childCount > 0 && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground/60">
                {childCount}
              </span>
            )}
          </button>
        )}

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={tp("folderOptions")}
            className={cn(
              "grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-all hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary",
              // Pointer-only reveal would strand touch users.
              menuOpen ? "opacity-100" : "opacity-0 max-lg:opacity-100 group-hover:opacity-100",
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
              <div className="absolute end-0 top-8 z-50 w-44 overflow-hidden rounded-lg bg-surface-3 py-1 shadow-lg ring-1 ring-white/10">
                {/* Absent at the bottom level rather than shown failing:
                    the database refuses a fourth level outright. */}
                {canNest && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      ctx.addSubfolder(folder.id);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm text-foreground transition-colors hover:bg-surface-2"
                  >
                    <FolderPlus className="size-4 shrink-0" />
                    {tp("newSubfolder")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDraft(folder.name);
                    ctx.startRename(folder.id);
                  }}
                  className="block w-full px-3 py-1.5 text-start text-sm text-foreground transition-colors hover:bg-surface-2"
                >
                  {tp("renameAction")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    ctx.removeFolder(folder.id);
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
        <div className="ms-4 space-y-0.5 border-s border-border ps-1.5">
          {children.map((child) => (
            <FolderNode key={child.id} folder={child} ctx={ctx} />
          ))}

          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              folders={ctx.folders}
              active={ctx.activeProjectId === p.id}
              compact
              onOpen={() => ctx.openProject(p.id)}
              onRename={(name) => ctx.renameProject(p.id, name)}
              onMoveToFolder={(folderId) => ctx.moveProject(p.id, folderId)}
              onSetCover={(assetId) => ctx.setCover(p.id, assetId)}
              onDelete={() => ctx.removeProject(p.id)}
            />
          ))}

          {childCount === 0 && (
            <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground/70">
              {tp("emptyFolder")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
