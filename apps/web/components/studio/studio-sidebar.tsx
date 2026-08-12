"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Plus, FolderSimple, Heart, CaretUpDown } from "@phosphor-icons/react";
import { useStudio } from "@/components/studio/studio-context";
import { useSession } from "@/lib/use-session";
import { useTimeLabel } from "@/lib/time-label";
import { cn } from "@/lib/utils";

export function StudioSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("studio");
  const ta = useTranslations("account");
  const router = useRouter();
  const pathname = usePathname();
  const { projects, projectsLoading, activeProjectId, setActiveProject, createProject } =
    useStudio();
  const { user, plan } = useSession();
  const timeLabel = useTimeLabel();

  const displayName = user?.name?.trim() || user?.email.split("@")[0] || "…";
  const initials =
    displayName
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  const inBrowser = pathname === "/projects";

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

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={onClose} aria-hidden />
      )}
      <aside
        className={cn(
          // On lg+ the sidebar is static (in flow); below lg it's a fixed drawer
          // that slides off the start edge — left in LTR, right in RTL. The hide
          // transform is scoped to max-lg so it never leaks onto the desktop layout.
          "fixed inset-y-0 start-0 z-40 flex w-[264px] flex-col bg-surface-1 p-3 transition-transform lg:static lg:z-auto",
          open ? "translate-x-0" : "max-lg:-translate-x-full max-lg:rtl:translate-x-full",
        )}
      >
        <button
          type="button"
          onClick={newProject}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-surface-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
        >
          <Plus className="size-4" weight="bold" />
          {t("createNewProject")}
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
            {t("myProjects")}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <Heart className="size-[18px]" />
            {t("favorites")}
          </button>
        </nav>

        <div className="my-4 h-px bg-white/[0.06]" />

        <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("recentProjects")}
        </p>
        <div className="mt-2 flex-1 space-y-1 overflow-y-auto">
          {projectsLoading &&
            Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg p-2">
                <span className="size-9 shrink-0 animate-pulse rounded-md bg-surface-3" />
                <span className="h-3.5 w-28 animate-pulse rounded bg-surface-3" />
              </div>
            ))}
          {projects.map((p) => {
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
                  {p.cover &&
                    (p.cover.kind === "video" ? (
                      // First frame via preload — video posters aren't
                      // generated yet (worker uses the video key itself).
                      <video
                        src={p.cover.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="size-full object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.cover.url} alt="" className="size-full object-cover" />
                    ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t("assets", { count: p.assetCount })} · {timeLabel(p.updatedAt)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            router.push("/settings");
            onClose();
          }}
          className="mt-2 flex items-center gap-3 rounded-lg p-2 text-start transition-colors hover:bg-surface-2"
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
      </aside>
    </>
  );
}
