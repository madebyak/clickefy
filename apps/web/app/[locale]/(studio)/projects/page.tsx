"use client";

import { useRouter } from "@/i18n/navigation";
import { FolderSimple, FolderPlus, Plus, DotsThree } from "@phosphor-icons/react";
import { useStudio, type Project } from "@/components/studio/studio-context";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";

function ProjectCard({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { folders, moveProjectToFolder } = useStudio();
  const cover = project.assets[0];
  return (
    <div className="group relative overflow-hidden rounded-xl bg-surface-2">
      <button type="button" onClick={() => onOpen(project.id)} className="block w-full text-start outline-none">
        <div className="aspect-[4/3] overflow-hidden bg-surface-3">
          {cover &&
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover.poster ?? cover.src}
              alt=""
              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />}
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-medium">{project.name}</p>
          <p className="text-xs text-muted-foreground">
            {project.assets.length} assets · {project.time}
          </p>
        </div>
      </button>
      <div className="absolute end-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <Menu
          align="end"
          panelClassName="w-52"
          trigger={({ toggle }) => (
            <button
              type="button"
              aria-label="Project options"
              onClick={toggle}
              className="grid size-8 place-items-center rounded-lg bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/80"
            >
              <DotsThree weight="bold" className="size-4" />
            </button>
          )}
        >
          {({ close }) => (
            <>
              <MenuLabel>Move to folder</MenuLabel>
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
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  moveProjectToFolder(project.id, null);
                  close();
                }}
              >
                Remove from folder
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const { folders, projects, setActiveProject, createProject, createFolder } = useStudio();

  const openProject = (id: string) => {
    setActiveProject(id);
    router.push("/create");
  };

  const newProject = () => {
    createProject(null);
    router.push("/create");
  };

  const unfiled = projects.filter((p) => p.folderId === null);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-[90rem]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">My Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">Organize your work into folders.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => createFolder("New folder")}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-surface-3 px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              <FolderPlus className="size-4" /> New folder
            </button>
            <button
              type="button"
              onClick={newProject}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="size-4" weight="bold" /> New project
            </button>
          </div>
        </div>

        <div className="mt-8 space-y-10">
          {folders.map((f) => {
            const items = projects.filter((p) => p.folderId === f.id);
            return (
              <section key={f.id}>
                <div className="mb-4 flex items-center gap-2">
                  <FolderSimple weight="fill" className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-medium">{f.name}</h2>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                {items.length ? (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {items.map((p) => (
                      <ProjectCard key={p.id} project={p} onOpen={openProject} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl bg-surface-1 px-4 py-8 text-center text-sm text-muted-foreground">
                    Empty — move a project here from its ··· menu.
                  </div>
                )}
              </section>
            );
          })}

          {unfiled.length > 0 && (
            <section>
              <div className="mb-4 flex items-center gap-2">
                <FolderSimple className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-medium">Unfiled</h2>
                <span className="text-xs text-muted-foreground">{unfiled.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {unfiled.map((p) => (
                  <ProjectCard key={p.id} project={p} onOpen={openProject} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
