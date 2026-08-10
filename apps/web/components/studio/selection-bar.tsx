"use client";

import { useTranslations } from "next-intl";
import { X, CopySimple, ArrowRight, DownloadSimple, Trash, CaretDown } from "@phosphor-icons/react";
import { useStudio } from "@/components/studio/studio-context";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";

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
  } = useStudio();

  if (selectedAssetIds.length === 0 || !activeProject || !activeProjectId) return null;

  const downloadSelected = () => {
    const chosen = activeAssets.filter((a) => selectedAssetIds.includes(a.id));
    chosen.forEach((a, i) =>
      setTimeout(() => {
        const el = document.createElement("a");
        el.href = a.src;
        el.download = a.src.split("/").pop() ?? "asset";
        document.body.appendChild(el);
        el.click();
        el.remove();
      }, i * 250),
    );
  };

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
