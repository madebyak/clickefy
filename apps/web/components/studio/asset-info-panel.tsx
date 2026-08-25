"use client";

/**
 * Right slide-over showing how one asset was generated.
 *
 * The asset row itself only knows its dimensions and timestamps, so the
 * provenance (prompt, references, model, tier) is fetched on open from
 * the asset-detail endpoint rather than carried in the masonry list —
 * a grid of fifty tiles should not hold fifty prompts in memory.
 */

import { useEffect, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { X, DownloadSimple, Copy, ArrowCounterClockwise, Heart } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { AssetDetail } from "@clickfy/sdk";
import { getSDK } from "@/lib/api";
import { cn } from "@/lib/utils";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-end text-xs font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

export function AssetInfoPanel({
  projectId,
  assetId,
  onClose,
  onReuse,
  onDownload,
  favorited,
  onToggleFavorite,
}: {
  projectId: string;
  assetId: string;
  onClose: () => void;
  /** Restore prompt + settings + references into the composer. */
  onReuse: (detail: AssetDetail) => void;
  onDownload: () => void;
  /**
   * Heart state is read from the studio's live asset cache rather than
   * the fetched detail, so toggling it here and toggling it on the tile
   * behind the panel never disagree.
   */
  favorited: boolean;
  onToggleFavorite: () => void;
}) {
  const t = useTranslations("studio");
  const format = useFormatter();
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setFailed(false);
    getSDK()
      .projects.getAsset(projectId, assetId)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [projectId, assetId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const gen = detail?.generation ?? null;
  const roleLabel = (role: string) =>
    role === "start_frame"
      ? t("startFrameRole")
      : role === "end_frame"
        ? t("endFrameRole")
        : t("referenceRole");

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={t("assetInfo")}
        className="fixed inset-y-0 end-0 z-50 flex w-[min(400px,100vw)] flex-col border-s border-border bg-surface-1 shadow-2xl shadow-black/50"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{t("assetInfo")}</h2>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Preview */}
          <div className="overflow-hidden rounded-xl bg-surface-2">
            {detail ? (
              detail.kind === "video" ? (
                <video
                  src={detail.url}
                  poster={detail.posterUrl ?? undefined}
                  controls
                  playsInline
                  className="w-full"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={detail.url} alt="" className="w-full" />
              )
            ) : (
              <div className="aspect-square w-full animate-pulse bg-surface-3" />
            )}
          </div>

          {failed && (
            <p className="mt-4 text-xs text-muted-foreground">{t("detailsUnavailable")}</p>
          )}

            {/* A file placed from My Assets has no prompt and no settings
                behind it, so "Copy prompt" and "Re-use" have nothing to act
                on. Hidden rather than disabled: a permanently dead button is
                worse than an absent one. */}
          {detail && detail.generation && (
            <>
              {/* Prompt, or the template it came from. A template's prompt
                  is ours, not the user's, so it is never shown. */}
              {gen?.prompt ? (
                <section className="mt-4">
                  <p className="mb-1.5 text-xs text-muted-foreground">{t("prompt")}</p>
                  <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-foreground">
                    {gen.prompt}
                  </p>
                </section>
              ) : gen?.templateTitle ? (
                <section className="mt-4">
                  <p className="mb-1.5 text-xs text-muted-foreground">
                    {t("madeWithTemplate")}
                  </p>
                  <p className="rounded-lg bg-surface-2 p-3 text-xs font-medium text-foreground">
                    {gen.templateTitle}
                  </p>
                </section>
              ) : null}

              {gen && gen.references.length > 0 && (
                <section className="mt-4">
                  <p className="mb-1.5 text-xs text-muted-foreground">{t("referencesUsed")}</p>
                  <div className="flex flex-wrap gap-2">
                    {gen.references.map((r, i) => (
                      <div key={`${r.url}-${i}`} className="w-16">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={r.url}
                          alt=""
                          className="size-16 rounded-lg object-cover ring-1 ring-border"
                        />
                        <p className="mt-1 truncate text-[10px] text-muted-foreground">
                          {roleLabel(r.role)}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="mt-4 divide-y divide-white/[0.06] rounded-lg bg-surface-2 px-3 py-1">
                {gen?.modelName && <Row label={t("model")} value={gen.modelName} />}
                {gen?.aspectRatio && <Row label={t("aspectRatio")} value={gen.aspectRatio} />}
                {gen?.quality && <Row label={t("quality")} value={gen.quality} />}
                {detail.width && detail.height && (
                  <Row label={t("dimensions")} value={`${detail.width} × ${detail.height}`} />
                )}
                {detail.durationSec != null && (
                  <Row label={t("duration")} value={`${Math.round(detail.durationSec)}s`} />
                )}
                {gen?.sound != null && (
                  <Row label={t("sound")} value={gen.sound ? t("soundOn") : t("soundOff")} />
                )}
                {detail.format && (
                  <Row label={t("format")} value={detail.format.toUpperCase()} />
                )}
                <Row
                  label={t("created")}
                  value={format.dateTime(new Date(detail.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                />
              </section>
            </>
          )}
        </div>

        <footer className="flex flex-wrap gap-2 border-t border-border p-3">
          <button
            type="button"
            aria-pressed={favorited}
            onClick={onToggleFavorite}
            className={cn(
              "inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors",
              favorited
                ? "bg-status-red/15 text-status-red hover:bg-status-red/25"
                : "bg-surface-3 text-foreground hover:bg-surface-2",
            )}
          >
            <Heart weight={favorited ? "fill" : "regular"} className="size-4" />
            {favorited ? t("favorited") : t("favorite")}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-surface-3 px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            <DownloadSimple className="size-4" /> {t("download")}
          </button>
          {/* Copy and Re-use need a user prompt to act on, so both are
              absent for template-sourced assets. */}
          {gen?.prompt && (
            <>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(gen.prompt!);
                  toast.success(t("promptCopied"));
                }}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-surface-3 px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                <Copy className="size-4" /> {t("copyPrompt")}
              </button>
              <button
                type="button"
                onClick={() => detail && onReuse(detail)}
                className={cn(
                  "inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-black transition-opacity hover:opacity-90",
                )}
              >
                <ArrowCounterClockwise className="size-4" /> {t("reuse")}
              </button>
            </>
          )}
        </footer>
      </aside>
    </>
  );
}
