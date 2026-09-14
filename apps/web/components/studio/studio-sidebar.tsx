"use client";

import { useState, useSyncExternalStore, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Plus, Heart, CaretUpDown, Images, X } from "@phosphor-icons/react";
import { useStudio } from "@/components/studio/studio-context";
import { ProjectRow } from "@/components/studio/project-row";
import { FolderTree } from "@/components/studio/folder-tree";
import { MyAssetsModal } from "@/components/media/my-assets-modal";
import { useSession } from "@/lib/use-session";
import { Modal } from "@/components/ui/modal";
import { StudioNavigation } from "@/components/studio/studio-navigation";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { cn } from "@/lib/utils";

const desktopQuery = "(min-width: 1024px)";
const subscribeDesktop = (notify: () => void) => {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

export function StudioSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("studio");
  const tn = useTranslations("nav");
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(desktopQuery).matches, () => true);
  useEffect(() => { if (desktop && open) onClose(); }, [desktop, open, onClose]);
  const tm = useTranslations("media");
  const [assetsOpen, setAssetsOpen] = useState(false);
  const ta = useTranslations("account");
  const router = useRouter();
  const pathname = usePathname();
  const {
    projects,
    projectsLoading,
    activeProjectId,
    setActiveProject,
    createProject,
    folders,
    renameProject,
    moveProjectToFolder,
    setProjectCover,
    deleteProject,
  } = useStudio();
  const { user, plan } = useSession();

  const displayName = user?.name?.trim() || user?.email.split("@")[0] || "…";
  const initials =
    displayName
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  const inBrowser = pathname === "/projects";
  const inFavorites = pathname === "/favorites";

  const openProject = (id: string) => {
    setActiveProject(id);
    router.push("/create");
    onClose();
  };

  const newProject = async () => {
    router.push("/create");
    onClose();
    // createProject re-throws so generation flows can abort; here the
    // failure toast already fired, so swallow to avoid an unhandled
    // rejection.
    await createProject(null).catch(() => undefined);
  };

  const content = (
    <>
      <div className="mb-2 flex shrink-0 items-center justify-between lg:hidden">
        <LanguageSwitcher />
        <button type="button" onClick={onClose} aria-label={t("close")} className="grid size-10 place-items-center rounded-lg hover:bg-surface-2"><X className="size-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <StudioNavigation className="mb-3 flex flex-col gap-1 xl:hidden" onNavigate={onClose} />
        <button
          type="button"
          onClick={newProject}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-surface-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
        >
          <Plus className="size-4" weight="bold" />
          {t("createNewProject")}
        </button>

        {/* Folders live here now rather than behind a navigation to
            /projects — browsing your own work should not cost you the
            canvas you are looking at. The page survives as "Show all". */}
        <div className="mt-4">
          <FolderTree
            onOpenProject={openProject}
            onShowAll={() => {
              router.push("/projects");
              onClose();
            }}
          />
        </div>

        {/* The folder tree is a variable-height list; "All favorites" is a
            fixed destination. Without a rule between them the last folder
            and the favorites row read as one continuous list. Same weight
            as the rule above Recent projects, so the sidebar has one
            grammar rather than two. */}
        <div className="my-3 h-px bg-white/[0.06]" />

        <nav className="space-y-1">
          <button
            type="button"
            onClick={() => {
              router.push("/favorites");
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              inFavorites
                ? "bg-surface-3 text-foreground"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Heart className="size-[18px]" weight={inFavorites ? "fill" : "regular"} />
            {t("favorites")}
          </button>
        </nav>

        <div className="my-4 h-px bg-white/[0.06]" />

        <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("recentProjects")}
        </p>
        <div className="mt-2 space-y-1">
          {projectsLoading &&
            Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg p-2">
                <span className="size-9 shrink-0 animate-pulse rounded-md bg-surface-3" />
                <span className="h-3.5 w-28 animate-pulse rounded bg-surface-3" />
              </div>
            ))}
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              folders={folders}
              active={!inBrowser && !inFavorites && activeProjectId === p.id}
              onOpen={() => openProject(p.id)}
              onRename={(name) => renameProject(p.id, name)}
              onMoveToFolder={(folderId) => moveProjectToFolder(p.id, folderId)}
              onSetCover={(assetId) => setProjectCover(p.id, assetId)}
              onDelete={() => void deleteProject(p.id)}
            />
          ))}
        </div>

      </div>

        {/* My Assets sits at the FOOT of the sidebar, above the profile:
            it is a place you visit occasionally to organise, not a
            destination you switch between while working. */}
        <button
          type="button"
          onClick={() => {
            setAssetsOpen(true);
            onClose();
          }}
          className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Images className="size-[18px]" />
          {tm("title")}
        </button>

        <button
          type="button"
          onClick={() => {
            router.push("/settings");
            onClose();
          }}
          className="mt-1 flex items-center gap-3 rounded-lg p-2 text-start transition-colors hover:bg-surface-2"
        >
          {user?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              className="size-9 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-purple text-xs font-semibold text-white">
              {initials}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {ta("planLabel", { plan: plan.tier })}
            </span>
          </span>
          <CaretUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
    </>
  );

  return (
    <>
      {desktop ? (
        <aside className="hidden w-[264px] shrink-0 flex-col bg-surface-1 p-3 lg:flex">{content}</aside>
      ) : open ? (
        <Modal label={tn("openMenu")} onClose={onClose} className="fixed inset-y-0 start-0 end-auto m-0 h-dvh max-h-dvh w-[min(320px,calc(100%-2rem))] rounded-none border-y-0 border-s-0">
          <div className="flex h-full flex-col p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{content}</div>
        </Modal>
      ) : null}
      <MyAssetsModal open={assetsOpen} onClose={() => setAssetsOpen(false)} />
    </>
  );
}
