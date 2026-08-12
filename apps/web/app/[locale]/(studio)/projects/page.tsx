"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  FolderSimple,
  FolderPlus,
  Plus,
  DotsThree,
  PencilSimple,
  Trash,
  Check,
  X,
} from "@phosphor-icons/react";
import { useStudio, type StudioFolder, type StudioProject } from "@/components/studio/studio-context";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useTimeLabel } from "@/lib/time-label";

/* ------------------------------------------------------------- inline rename */

function InlineRename({
  initial,
  ariaLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  ariaLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("projects");
  const [value, setValue] = useState(initial);
  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initial) onSubmit(trimmed);
    else onCancel();
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={commit}
        className="h-8 py-1 text-sm"
      />
      <button
        type="button"
        aria-label={t("save")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={commit}
        className="grid size-7 shrink-0 place-items-center rounded-md text-status-green hover:bg-surface-3"
      >
        <Check weight="bold" className="size-4" />
      </button>
      <button
        type="button"
        aria-label={t("cancel")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCancel}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-3"
      >
        <X weight="bold" className="size-4" />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------- covers */

function ProjectCover({ project }: { project: StudioProject }) {
  if (!project.cover) return null;
  if (project.cover.kind === "video") {
    return (
      <video
        src={project.cover.url}
        muted
        playsInline
        preload="metadata"
        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={project.cover.url}
      alt=""
      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
    />
  );
}

/* -------------------------------------------------------------- project card */

function ProjectCard({
  project,
  onOpen,
  onRequestDelete,
}: {
  project: StudioProject;
  onOpen: (id: string) => void;
  onRequestDelete: (project: StudioProject) => void;
}) {
  const t = useTranslations("projects");
  const { folders, moveProjectToFolder, renameProject } = useStudio();
  const timeLabel = useTimeLabel();
  const [renaming, setRenaming] = useState(false);

  return (
    <div className="group relative overflow-hidden rounded-xl bg-surface-2">
      <button
        type="button"
        onClick={() => onOpen(project.id)}
        className="block w-full text-start outline-none"
      >
        <div className="aspect-[4/3] overflow-hidden bg-surface-3">
          <ProjectCover project={project} />
        </div>
      </button>
      <div className="p-3">
        {renaming ? (
          <InlineRename
            initial={project.name}
            ariaLabel={t("renameProjectAction")}
            onSubmit={(name) => {
              renameProject(project.id, name);
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => onOpen(project.id)}
            className="block w-full text-start outline-none"
          >
            <p className="truncate text-sm font-medium">{project.name}</p>
            <p className="text-xs text-muted-foreground">
              {t("assets", { count: project.assetCount })} · {timeLabel(project.updatedAt)}
            </p>
          </button>
        )}
      </div>
      <div className="absolute end-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Menu
          align="end"
          panelClassName="w-52"
          trigger={({ toggle }) => (
            <button
              type="button"
              aria-label={t("projectOptions")}
              onClick={toggle}
              className="grid size-8 place-items-center rounded-lg bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/80"
            >
              <DotsThree weight="bold" className="size-4" />
            </button>
          )}
        >
          {({ close }) => (
            <>
              <MenuItem
                onClick={() => {
                  setRenaming(true);
                  close();
                }}
              >
                <PencilSimple className="size-4 text-muted-foreground" />
                {t("renameProjectAction")}
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>{t("moveToFolder")}</MenuLabel>
              {folders.map((f) => (
                <MenuItem
                  key={f.id}
                  onClick={() => {
                    moveProjectToFolder(project.id, f.id);
                    close();
                  }}
                >
                  <FolderSimple className="size-4 text-muted-foreground" />
                  {f.name}
                </MenuItem>
              ))}
              {project.folderId !== null && (
                <MenuItem
                  onClick={() => {
                    moveProjectToFolder(project.id, null);
                    close();
                  }}
                >
                  {t("removeFromFolder")}
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem
                destructive
                onClick={() => {
                  onRequestDelete(project);
                  close();
                }}
              >
                <Trash className="size-4" />
                {t("deleteProjectAction")}
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- folder head */

function FolderHeader({
  folder,
  count,
  onRequestDelete,
}: {
  folder: StudioFolder;
  count: number;
  onRequestDelete: (folder: StudioFolder) => void;
}) {
  const t = useTranslations("projects");
  const { renameFolder } = useStudio();
  const [renaming, setRenaming] = useState(false);

  return (
    <div className="mb-4 flex items-center gap-2">
      <FolderSimple weight="fill" className="size-4 shrink-0 text-muted-foreground" />
      {renaming ? (
        <InlineRename
          initial={folder.name}
          ariaLabel={t("renameAction")}
          onSubmit={(name) => {
            renameFolder(folder.id, name);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <>
          <h2 className="text-sm font-medium">{folder.name}</h2>
          <span className="text-xs text-muted-foreground">{count}</span>
          <Menu
            align="start"
            panelClassName="w-44"
            trigger={({ toggle }) => (
              <button
                type="button"
                aria-label={t("folderOptions")}
                onClick={toggle}
                className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <DotsThree weight="bold" className="size-4" />
              </button>
            )}
          >
            {({ close }) => (
              <>
                <MenuItem
                  onClick={() => {
                    setRenaming(true);
                    close();
                  }}
                >
                  <PencilSimple className="size-4 text-muted-foreground" />
                  {t("renameAction")}
                </MenuItem>
                <MenuItem
                  destructive
                  onClick={() => {
                    onRequestDelete(folder);
                    close();
                  }}
                >
                  <Trash className="size-4" />
                  {t("deleteFolderAction")}
                </MenuItem>
              </>
            )}
          </Menu>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- page */

export default function ProjectsPage() {
  const t = useTranslations("projects");
  const router = useRouter();
  const {
    folders,
    projects,
    projectsLoading,
    setActiveProject,
    createProject,
    createFolder,
    deleteFolder,
    deleteProject,
  } = useStudio();

  const [pendingFolderDelete, setPendingFolderDelete] = useState<StudioFolder | null>(null);
  const [pendingProjectDelete, setPendingProjectDelete] = useState<StudioProject | null>(null);

  const openProject = (id: string) => {
    setActiveProject(id);
    router.push("/create");
  };

  const newProject = async () => {
    router.push("/create");
    // createProject re-throws for generation flows; the failure toast
    // already fired here, so swallow to avoid an unhandled rejection.
    await createProject(null).catch(() => undefined);
  };

  const unfiled = projects.filter((p) => p.folderId === null);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-[90rem]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("heading")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("sub")}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void createFolder(t("defaultFolderName"))}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-surface-3 px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              <FolderPlus className="size-4" /> {t("newFolder")}
            </button>
            <button
              type="button"
              onClick={() => void newProject()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="size-4" weight="bold" /> {t("newProject")}
            </button>
          </div>
        </div>

        {projectsLoading && (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        )}

        <div className="mt-8 space-y-10">
          {folders.map((f) => {
            const items = projects.filter((p) => p.folderId === f.id);
            return (
              <section key={f.id}>
                <FolderHeader folder={f} count={items.length} onRequestDelete={setPendingFolderDelete} />
                {items.length ? (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {items.map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        onOpen={openProject}
                        onRequestDelete={setPendingProjectDelete}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl bg-surface-1 px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("emptyFolder")}
                  </div>
                )}
              </section>
            );
          })}

          {unfiled.length > 0 && (
            <section>
              <div className="mb-4 flex items-center gap-2">
                <FolderSimple className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-medium">{t("unfiled")}</h2>
                <span className="text-xs text-muted-foreground">{unfiled.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {unfiled.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onOpen={openProject}
                    onRequestDelete={setPendingProjectDelete}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingFolderDelete !== null}
        title={t("confirmDeleteFolderTitle")}
        body={t("confirmDeleteFolderBody")}
        confirmLabel={t("confirmDelete")}
        cancelLabel={t("cancel")}
        onConfirm={() => {
          if (pendingFolderDelete) void deleteFolder(pendingFolderDelete.id);
          setPendingFolderDelete(null);
        }}
        onCancel={() => setPendingFolderDelete(null)}
      />
      <ConfirmDialog
        open={pendingProjectDelete !== null}
        title={t("confirmDeleteProjectTitle")}
        body={t("confirmDeleteProjectBody")}
        confirmLabel={t("confirmDelete")}
        cancelLabel={t("cancel")}
        onConfirm={() => {
          if (pendingProjectDelete) void deleteProject(pendingProjectDelete.id);
          setPendingProjectDelete(null);
        }}
        onCancel={() => setPendingProjectDelete(null)}
      />
    </main>
  );
}
