"use client";

/**
 * "My Assets" — the media library, as a modal.
 *
 * ON THE NATIVE <dialog>, like `draw-modal` and `confirm-dialog`: the
 * browser gives a real focus trap (the rest of the document goes inert),
 * Escape, top-layer stacking above every z-index in the app, and focus
 * restored to whatever opened it. Those are the four things a hand-rolled
 * div overlay gets wrong, and they are not worth re-deriving.
 *
 * TWO MODES, one component. `mode="browse"` is a file manager reached from
 * the sidebar. `mode="pick"` is the same grid reached from the prompt bar,
 * where clicking a tile returns it as a reference rather than selecting it.
 * The difference is one prop because the browsing, searching and uploading
 * are identical — forking them would be two files drifting apart.
 *
 * FOLDERS SHOW THEIR CONTENTS. A folder tile renders a mosaic of the media
 * inside it rather than a folder glyph, because "which folder was the
 * hero shots in" is answered by looking, not by reading.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CaretRight,
  DotsThree,
  FolderPlus,
  FolderSimple,
  MagnifyingGlass,
  Trash,
  Check,
  Images,
  Stack,
  UploadSimple,
  VideoCamera,
  X,
} from "@phosphor-icons/react";

import type { MediaAsset, MediaFolder } from "@clickfy/sdk";
import { formatBytes } from "@clickfy/types";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  MEDIA_ACCEPT,
  useBreadcrumb,
  useMediaBrowse,
  useMediaLibrary,
  type UploadingFile,
} from "@/lib/use-media-library";
import { useStudioMaybe } from "@/components/studio/studio-context";

/** Tile sizes, largest tiles first. Four steps, same as the canvas grid. */
const TILE_COLUMNS = [2, 3, 4, 6] as const;
type TileSize = 0 | 1 | 2 | 3;
const DEFAULT_TILE: TileSize = 1;

/** Deepest folder level; matches the database's own limit. */
const MAX_DEPTH = 2;

export function MyAssetsModal({
  open,
  onClose,
  mode = "browse",
  onPick,
  pickDisabledReason,
}: {
  open: boolean;
  onClose: () => void;
  /** `pick` returns a file to the caller; `browse` just manages them. */
  mode?: "browse" | "pick";
  /** Commit the selection as prompt references. */
  onPick?: (assets: MediaAsset[]) => void;
  /** Set when the current model cannot take references at all. */
  pickDisabledReason?: string | null;
}) {
  const t = useTranslations("media");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    folders,
    assets,
    usage,
    isLoading,
    uploading,
    uploadFiles,
    createFolder,
    renameFolder,
    deleteFolder,
    deleteAssets,
    moveAsset,
    renameAsset,
    placeInProject,
  } = useMediaLibrary();

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tile, setTile] = useState<TileSize>(DEFAULT_TILE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingAssetId, setRenamingAssetId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /**
   * Where "Add to project" sends files.
   *
   * FROM CONTEXT, NOT A PROP. This used to be drilled in by each call
   * site, and the sidebar simply forgot — leaving the button greyed out
   * there permanently with no way to see why. The studio already knows
   * which project is open; asking it directly removes the whole class of
   * bug.
   *
   * Null only when the modal is mounted outside the studio (the
   * standalone composer), where there is no canvas at all — so the
   * button is hidden rather than disabled.
   */
  const studio = useStudioMaybe();
  const [placing, setPlacing] = useState(false);

  /**
   * A project is created LAZILY on the first generation, so a fresh
   * /create genuinely has none. Rather than refuse, create one the same
   * way a generation would: starting a project from your own brand
   * images instead of from a prompt is a real way to work, not an error.
   */
  const addToProject = useCallback(
    async (payload: { assetIds?: string[]; folderId?: string }) => {
      if (!studio || placing) return;
      setPlacing(true);
      try {
        const projectId = studio.activeProjectId ?? (await studio.createProject(null));
        placeInProject({ projectId, ...payload });
        setSelected(new Set());
      } catch {
        // `createProject` has already said so; a second toast would only
        // repeat it.
      } finally {
        setPlacing(false);
      }
    },
    [studio, placing, placeInProject],
  );

  const view = useMediaBrowse(folders, assets, currentFolderId, search);
  const trail = useBreadcrumb(folders, currentFolderId);
  const currentDepth = trail.length; // 0 at root, 3 inside a depth-2 folder

  /* ------------------------------------------------- dialog lifecycle */

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Reset the transient view each time it opens. Coming back to a search
  // term you typed a week ago, in a folder you have forgotten navigating
  // into, reads as a bug.
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelected(new Set());
      setRenamingId(null);
    }
  }, [open]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      void uploadFiles(Array.from(list), currentFolderId);
    },
    [uploadFiles, currentFolderId],
  );

  const addFolder = async () => {
    if (currentDepth > MAX_DEPTH) return;
    await createFolder({ name: t("newFolderName"), parentId: currentFolderId })
      .then((f) => setRenamingId(f.id))
      .catch(() => undefined);
  };

  const columns = TILE_COLUMNS[tile];
  const canNest = currentDepth <= MAX_DEPTH;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        // Escape backs out of a search before it closes the library.
        if (search) {
          e.preventDefault();
          setSearch("");
        }
      }}
      className={cn(
        "m-auto w-[min(92vw,1180px)] max-w-none rounded-2xl bg-surface-1 p-0 text-foreground",
        "backdrop:bg-black/70 backdrop:backdrop-blur-sm",
      )}
    >
      <div className="flex h-[min(86vh,820px)] flex-col">
        {/* ── header ─────────────────────────────────────────────── */}
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {mode === "pick" ? t("pickTitle") : t("title")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("usageLine", {
                used: formatBytes(usage.usedBytes),
                quota: formatBytes(usage.quotaBytes),
              })}
            </p>
          </div>

          {/* Storage bar. Only meaningful once something is stored, and a
              0% bar on an empty library is noise. */}
          {usage.usedBytes > 0 && (
            <div className="hidden w-32 sm:block">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    usage.fraction > 0.9 ? "bg-status-red" : "bg-primary",
                  )}
                  style={{ width: `${Math.max(2, usage.fraction * 100)}%` }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="size-4" weight="bold" />
          </button>
        </header>

        {/* ── toolbar ────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <div className="relative min-w-[10rem] flex-1">
            <MagnifyingGlass className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 w-full rounded-lg bg-surface-2 ps-9 pe-3 text-sm outline-none ring-primary transition-shadow placeholder:text-muted-foreground focus-visible:ring-2"
            />
          </div>

          {/* Tile size. Same four-step idea as the canvas density control,
              so the two grids in the product behave the same way. */}
          <div className="hidden items-center gap-2 sm:flex">
            <input
              type="range"
              min={0}
              max={TILE_COLUMNS.length - 1}
              step={1}
              value={tile}
              onChange={(e) => setTile(Number(e.target.value) as TileSize)}
              aria-label={t("tileSize")}
              className={cn(
                "h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-surface-3",
                "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none",
                "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
                "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full",
                "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary",
              )}
            />
          </div>

          <button
            type="button"
            onClick={addFolder}
            disabled={!canNest || !!search}
            title={canNest ? t("newFolder") : t("maxDepthReached")}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "gap-1.5",
              (!canNest || !!search) && "pointer-events-none opacity-40",
            )}
          >
            <FolderPlus className="size-4" />
            <span className="hidden sm:inline">{t("newFolder")}</span>
          </button>

          {/* Everything in the open folder, including its sub-folders, in
              one gesture — the case where selecting forty tiles by hand is
              the wrong interaction. Only inside a folder: at the root it
              would mean "the entire library", which nobody means. */}
          {currentFolderId && studio && !search && (
            <button
              type="button"
              disabled={placing}
              onClick={() => void addToProject({ folderId: currentFolderId })}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
            >
              <Stack className="size-4" />
              <span className="hidden sm:inline">{t("addFolderToProject")}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={cn(buttonVariants({ variant: "primary", size: "sm" }), "gap-1.5")}
          >
            <UploadSimple className="size-4" weight="bold" />
            {t("upload")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={MEDIA_ACCEPT}
            onChange={(e) => {
              onFiles(e.target.files);
              // Reset so re-picking the same file fires change again.
              e.target.value = "";
            }}
            className="hidden"
          />
        </div>

        {/* ── breadcrumb ─────────────────────────────────────────── */}
        {!view.searching && (
          <nav className="flex items-center gap-1 px-5 py-2 text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => setCurrentFolderId(null)}
              className={cn(
                "rounded px-1.5 py-0.5 transition-colors hover:text-foreground",
                currentFolderId === null && "font-medium text-foreground",
              )}
            >
              {t("allFiles")}
            </button>
            {trail.map((f, i) => (
              <span key={f.id} className="flex items-center gap-1">
                <CaretRight className="size-3 shrink-0 opacity-50 rtl:-scale-x-100" />
                <button
                  type="button"
                  onClick={() => setCurrentFolderId(f.id)}
                  className={cn(
                    "max-w-[12rem] truncate rounded px-1.5 py-0.5 transition-colors hover:text-foreground",
                    i === trail.length - 1 && "font-medium text-foreground",
                  )}
                >
                  {f.name}
                </button>
              </span>
            ))}
          </nav>
        )}

        {/* ── grid ───────────────────────────────────────────────── */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-5 pb-5"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
        >
          {pickDisabledReason && (
            <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
              {pickDisabledReason}
            </p>
          )}

          {isLoading ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {Array.from({ length: columns * 2 }, (_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-surface-2" />
              ))}
            </div>
          ) : view.folders.length === 0 &&
            view.assets.length === 0 &&
            uploading.length === 0 ? (
            <EmptyState searching={view.searching} onUpload={() => fileInputRef.current?.click()} />
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {uploading.map((u) => (
                <UploadingTile key={u.id} file={u} />
              ))}

              {view.folders.map((f) => (
                <FolderTile
                  key={f.id}
                  folder={f}
                  assets={assets}
                  folders={folders}
                  renaming={renamingId === f.id}
                  onOpen={() => {
                    setSearch("");
                    setCurrentFolderId(f.id);
                  }}
                  onRename={(name) => {
                    setRenamingId(null);
                    const trimmed = name.trim();
                    if (trimmed && trimmed !== f.name) renameFolder({ id: f.id, name: trimmed });
                  }}
                  onStartRename={() => setRenamingId(f.id)}
                  onDelete={() => deleteFolder(f.id)}
                />
              ))}

              {view.assets.map((a) => (
                <AssetTile
                  key={a.id}
                  asset={a}
                  selected={selected.has(a.id)}
                  renaming={renamingAssetId === a.id}
                  folders={folders}
                  onToggleSelect={() => toggleSelected(a.id)}
                  onStartRename={() => setRenamingAssetId(a.id)}
                  onRename={(name) => {
                    setRenamingAssetId(null);
                    const trimmed = name.trim();
                    if (trimmed && trimmed !== a.name) renameAsset({ id: a.id, name: trimmed });
                  }}
                  onMove={(folderId) => moveAsset({ id: a.id, folderId })}
                />
              ))}

            </div>
          )}
        </div>

        {/* ── selection bar ──────────────────────────────────────
            Selection drives BOTH modes rather than pick-mode clicking
            through immediately. One mental model, and the only shape in
            which multi-select works at all: a click that fires an action
            can never mean "and also this one". */}
        {selected.size > 0 && (
          <footer className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
            <span className="text-sm text-muted-foreground">
              {t("selectedCount", { count: selected.size })}
            </span>
            <div className="flex-1" />

            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t("clearSelection")}
            </button>

            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "gap-1.5 text-status-red",
              )}
            >
              <Trash className="size-4" />
              {t("delete")}
            </button>

            {/* Add to the canvas. Available in both modes — organising and
                placing are the same gesture from the user's side. */}
            {/* Hidden, not disabled, outside the studio: there is no
                canvas to add to there, and a permanently grey button
                explains nothing. */}
            {studio && (
              <button
                type="button"
                disabled={placing}
                onClick={() => void addToProject({ assetIds: [...selected] })}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "gap-1.5",
                  placing && "opacity-60",
                )}
              >
                <Stack className="size-4" />
                {t("addToProject")}
              </button>
            )}

            {/* Only in the composer: there is no prompt to attach to from
                the sidebar. */}
            {mode === "pick" && (
              <button
                type="button"
                onClick={() => {
                  const picked = assets.filter((a) => selected.has(a.id));
                  onPick?.(picked);
                  setSelected(new Set());
                }}
                className={cn(buttonVariants({ variant: "primary", size: "sm" }), "gap-1.5")}
              >
                <Images className="size-4" weight="bold" />
                {t("addAsReference")}
              </button>
            )}
          </footer>
        )}

        <ConfirmDialog
          open={confirmDelete}
          title={t("deleteConfirmTitle", { count: selected.size })}
          body={t("deleteConfirmBody")}
          confirmLabel={t("deleteConfirmAction")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            deleteAssets([...selected]);
            setSelected(new Set());
            setConfirmDelete(false);
          }}
        />
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A file mid-upload.
 *
 * Deliberately the same SHAPE as a real tile so the grid does not reflow
 * when it lands — and deliberately loud about being unfinished, because
 * the doubt this removes is "did it even take my file?".
 */
function UploadingTile({ file }: { file: UploadingFile }) {
  const t = useTranslations("media");
  const pct = Math.round(file.progress * 100);
  return (
    <div className="overflow-hidden rounded-xl bg-surface-2 ring-1 ring-primary/30">
      <div className="relative grid aspect-square place-items-center bg-surface-3/40">
        <div className="w-3/4 text-center">
          <div className="mx-auto h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
          <p className="mt-2 text-xs font-medium tabular-nums text-primary">
            {file.status === "error" ? t("uploadErrorShort") : `${pct}%`}
          </p>
        </div>
        <span className="absolute start-2 top-2 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          {t("uploadingBadge")}
        </span>
      </div>
      <div className="px-3 py-2">
        <p className="truncate text-sm">{file.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("uploadingLabel")}</p>
      </div>
    </div>
  );
}

function EmptyState({ searching, onUpload }: { searching: boolean; onUpload: () => void }) {
  const t = useTranslations("media");
  return (
    <div className="grid min-h-[18rem] place-items-center text-center">
      <div>
        <FolderSimple className="mx-auto size-10 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium">
          {searching ? t("noResults") : t("emptyTitle")}
        </p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
          {searching ? t("noResultsBody") : t("emptyBody")}
        </p>
        {!searching && (
          <button
            type="button"
            onClick={onUpload}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}
          >
            {t("upload")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A folder, shown as a mosaic of what is inside it.
 *
 * Counts everything NESTED, not just its direct children — a folder whose
 * files all live one level down would otherwise read as empty, which is
 * exactly the folder you most want to see into.
 */
function FolderTile({
  folder,
  assets,
  folders,
  renaming,
  onOpen,
  onRename,
  onStartRename,
  onDelete,
}: {
  folder: MediaFolder;
  assets: MediaAsset[];
  folders: MediaFolder[];
  renaming: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onStartRename: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("media");
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(folder.name);

  /**
   * Focus and select the name once, on mount.
   *
   * `useCallback` with no deps is load-bearing. An INLINE ref callback gets
   * a fresh identity every render, so React detaches and re-attaches it
   * after each keystroke — and the re-attach re-ran `select()`, leaving the
   * whole name highlighted so the next character REPLACED it. Typing
   * "Clickefy" left you with "y".
   */
  const focusInput = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const descendantIds = useMemo(() => {
    const ids = new Set([folder.id]);
    // Three levels deep at most, so two passes always closes the set.
    for (let i = 0; i < 2; i++) {
      for (const f of folders) {
        if (f.parentId && ids.has(f.parentId)) ids.add(f.id);
      }
    }
    return ids;
  }, [folder.id, folders]);

  const inside = useMemo(
    () => assets.filter((a) => a.folderId && descendantIds.has(a.folderId)),
    [assets, descendantIds],
  );
  const preview = inside.slice(0, 4);

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full overflow-hidden rounded-xl bg-surface-2 text-start outline-none ring-primary transition-colors hover:bg-surface-3 focus-visible:ring-2"
      >
        <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-px bg-surface-3/60">
          {preview.length === 0 ? (
            <div className="col-span-2 row-span-2 grid place-items-center bg-surface-2">
              <FolderSimple className="size-8 text-muted-foreground/40" />
            </div>
          ) : (
            Array.from({ length: 4 }, (_, i) => {
              const a = preview[i];
              return (
                <div key={i} className="overflow-hidden bg-surface-2">
                  {a ? (
                    a.kind === "video" ? (
                      <video src={a.url} muted playsInline className="size-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.url} alt="" loading="lazy" className="size-full object-cover" />
                    )
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div className="px-3 py-2">
          {renaming ? (
            <input
              ref={focusInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => onRename(draft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRename(draft);
                if (e.key === "Escape") {
                  setDraft(folder.name);
                  onRename(folder.name);
                }
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded bg-surface-1 px-1 py-0.5 text-sm outline-none ring-1 ring-primary"
            />
          ) : (
            <p className="truncate text-sm font-medium">{folder.name}</p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("itemCount", { count: inside.length })}
          </p>
        </div>
      </button>

      <div className="absolute end-2 top-2">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={t("folderOptions")}
          className={cn(
            "grid size-7 place-items-center rounded-md bg-black/50 text-white backdrop-blur transition-opacity",
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
          )}
        >
          <DotsThree className="size-4" weight="bold" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
            <div className="absolute end-0 top-8 z-50 w-36 overflow-hidden rounded-lg bg-surface-3 py-1 shadow-lg ring-1 ring-white/10">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setDraft(folder.name);
                  onStartRename();
                }}
                className="block w-full px-3 py-1.5 text-start text-sm transition-colors hover:bg-surface-2"
              >
                {t("rename")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="block w-full px-3 py-1.5 text-start text-sm text-status-red transition-colors hover:bg-surface-2"
              >
                {t("deleteFolder")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AssetTile({
  asset,
  selected,
  renaming,
  folders,
  onToggleSelect,
  onStartRename,
  onRename,
  onMove,
}: {
  asset: MediaAsset;
  selected: boolean;
  renaming: boolean;
  folders: MediaFolder[];
  onToggleSelect: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onMove: (folderId: string | null) => void;
}) {
  const t = useTranslations("media");
  const [menuOpen, setMenuOpen] = useState(false);
  const [movingOpen, setMovingOpen] = useState(false);
  const [draft, setDraft] = useState(asset.name);

  // Stable, so React does not detach and re-attach the ref every render —
  // which would re-run select() after each keystroke and leave you typing
  // over your own text. Learned the hard way on the folder rename.
  const focusInput = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl bg-surface-2 ring-primary transition-shadow",
        selected && "ring-2",
      )}
    >
      <button
        type="button"
        onClick={onToggleSelect}
        aria-pressed={selected}
        className="block w-full text-start outline-none"
      >
        <div className="relative aspect-square overflow-hidden">
          {asset.kind === "video" ? (
            <>
              <video
                src={asset.url}
                muted
                playsInline
                preload="metadata"
                className="size-full object-cover"
              />
              <span className="absolute start-2 top-2 grid size-6 place-items-center rounded-md bg-black/60 text-white backdrop-blur">
                <VideoCamera className="size-3.5" weight="fill" />
              </span>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.url} alt={asset.name} loading="lazy" className="size-full object-cover" />
          )}

          {/* A tick that is always visible once selected, and appears on
              hover otherwise — so it is obvious the tile is selectable
              before you click, not only after. */}
          <span
            className={cn(
              "absolute end-2 top-2 grid size-6 place-items-center rounded-full border transition-all",
              selected
                ? "border-primary bg-primary text-black"
                : "border-white/60 bg-black/40 text-transparent opacity-0 group-hover:opacity-100",
            )}
          >
            <Check className="size-3.5" weight="bold" />
          </span>
        </div>
      </button>

      <div className="flex items-center gap-1 px-3 py-2">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              ref={focusInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => onRename(draft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRename(draft);
                if (e.key === "Escape") {
                  setDraft(asset.name);
                  onRename(asset.name);
                }
                e.stopPropagation();
              }}
              className="w-full rounded bg-surface-1 px-1 py-0.5 text-sm outline-none ring-1 ring-primary"
            />
          ) : (
            <p className="truncate text-sm">{asset.name}</p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(asset.sizeBytes)}</p>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t("fileOptions")}
            className={cn(
              "grid size-7 place-items-center rounded-md text-muted-foreground transition-opacity hover:bg-surface-3 hover:text-foreground",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
            )}
          >
            <DotsThree className="size-4" weight="bold" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => {
                  setMenuOpen(false);
                  setMovingOpen(false);
                }}
                aria-hidden
              />
              <div className="absolute end-0 bottom-9 z-50 max-h-64 w-48 overflow-y-auto rounded-lg bg-surface-3 py-1 shadow-lg ring-1 ring-white/10">
                {movingOpen ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onMove(null);
                        setMenuOpen(false);
                        setMovingOpen(false);
                      }}
                      className="block w-full truncate px-3 py-1.5 text-start text-sm transition-colors hover:bg-surface-2"
                    >
                      {t("moveToRoot")}
                    </button>
                    {folders.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          onMove(f.id);
                          setMenuOpen(false);
                          setMovingOpen(false);
                        }}
                        className="block w-full truncate px-3 py-1.5 text-start text-sm transition-colors hover:bg-surface-2"
                        // Indented by depth so the flat list still reads
                        // as the tree it came from.
                        style={{ paddingInlineStart: `${12 + f.depth * 12}px` }}
                      >
                        {f.name}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setDraft(asset.name);
                        onStartRename();
                      }}
                      className="block w-full px-3 py-1.5 text-start text-sm transition-colors hover:bg-surface-2"
                    >
                      {t("renameFile")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMovingOpen(true)}
                      className="block w-full px-3 py-1.5 text-start text-sm transition-colors hover:bg-surface-2"
                    >
                      {t("moveTo")}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
