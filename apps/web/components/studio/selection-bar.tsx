"use client";

import { useTranslations } from "next-intl";
import {
  X,
  CopySimple,
  ArrowRight,
  DownloadSimple,
  Heart,
  Trash,
  CaretDown,
} from "@phosphor-icons/react";
import { useStudio } from "@/components/studio/studio-context";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { downloadAssets } from "@/lib/download-asset";

function ProjectPicker({
  label,
  icon,
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  onPick: (projectId: string) => void;
}) {
  const t = useTranslations("studio");
  const { projects, activeProjectId } = useStudio();
  const targets = projects.filter((p) => p.id !== activeProjectId);

  return (
    <Menu
      align="end"
      side="top"
      panelClassName="max-h-72 w-60 overflow-y-auto"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-surface-2 px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-1"
        >
          {icon}
          <span className="hidden sm:inline">{label}</span>
          <CaretDown className="size-3 text-muted-foreground" />
        </button>
      )}
    >
      {({ close }) => (
        <>
          <MenuLabel>{label}</MenuLabel>
          {targets.length ? (
            targets.map((p) => (
              <MenuItem
                key={p.id}
                onClick={() => {
                  onPick(p.id);
                  close();
                }}
              >
                <span className="size-6 shrink-0 overflow-hidden rounded bg-surface-2">
                  {p.cover &&
                    (p.cover.kind === "video" ? (
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
                <span className="truncate">{p.name}</span>
              </MenuItem>
            ))
          ) : (
            <p className="px-2 py-2 text-sm text-muted-foreground">{t("noOtherProjects")}</p>
          )}
        </>
      )}
    </Menu>
  );
}

export function SelectionBar() {
  const t = useTranslations("studio");
  const {
    selectedAssetIds,
    clearSelection,
    activeProject,
    activeProjectId,
    activeAssets,
    copyAssets,
    moveAssets,
    deleteAssets,
    setAssetsFavorite,
  } = useStudio();

  if (selectedAssetIds.length === 0 || !activeProject || !activeProjectId) return null;

  // One button, not a favorite/unfavorite pair: it favorites unless the
  // whole selection is already favorited, which is the only case where
  // "add to favorites" would be a no-op and the user obviously meant the
  // opposite.
  const selected = activeAssets.filter((a) => selectedAssetIds.includes(a.id));
  const allFavorited = selected.length > 0 && selected.every((a) => a.favorited);

  const downloadSelected = () =>
    downloadAssets(activeAssets.filter((a) => selectedAssetIds.includes(a.id)));

  return (
    <div className="mb-3 flex items-center gap-2 rounded-2xl bg-surface-3 p-2 shadow-2xl shadow-black/40">
      <button
        type="button"
        aria-label={t("clearSelection")}
        onClick={clearSelection}
        className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <X className="size-4" />
      </button>
      <span className="px-1 text-sm font-medium tabular-nums">
        {t("selected", { count: selectedAssetIds.length })}
      </span>

      <div className="ms-auto flex items-center gap-2">
        <ProjectPicker
          label={t("copyTo")}
          icon={<CopySimple className="size-4" />}
          onPick={(id) => copyAssets(selectedAssetIds, id)}
        />
        <ProjectPicker
          label={t("moveTo")}
          icon={<ArrowRight className="size-4 rtl:-scale-x-100" />}
          onPick={(id) => moveAssets(selectedAssetIds, activeProjectId, id)}
        />
        {/* Labelled like the Copy/Move pickers rather than an icon in a
            row of icons: favouriting a whole selection is a decision, and
            an unlabelled heart next to Download and Delete reads as
            decoration. Collapses to the icon on narrow screens, same as
            its neighbours. */}
        <button
          type="button"
          onClick={() => setAssetsFavorite(selectedAssetIds, !allFavorited)}
          aria-label={allFavorited ? t("unfavoriteSelected") : t("favoriteSelected")}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-surface-2 px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-1"
        >
          <Heart
            weight={allFavorited ? "fill" : "regular"}
            className={cn("size-4", allFavorited && "text-status-red")}
          />
          <span className="hidden sm:inline">
            {allFavorited ? t("unfavoriteSelectedShort") : t("favoriteSelectedShort")}
          </span>
        </button>
        <button
          type="button"
          onClick={downloadSelected}
          aria-label={t("downloadSelected")}
          className="grid size-9 place-items-center rounded-lg bg-surface-2 text-foreground transition-colors hover:bg-surface-1"
        >
          <DownloadSimple className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => deleteAssets(activeProjectId, selectedAssetIds)}
          aria-label={t("deleteSelected")}
          className="grid size-9 place-items-center rounded-lg bg-surface-2 text-status-red transition-colors hover:bg-status-red/15"
        >
          <Trash className="size-4" />
        </button>
      </div>
    </div>
  );
}
