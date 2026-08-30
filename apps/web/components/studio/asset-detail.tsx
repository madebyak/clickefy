"use client";

/**
 * Shared building blocks for showing HOW an asset was generated —
 * consumed by two surfaces that must never drift apart:
 *
 *   - the Details slide-over (`AssetInfoPanel`, opened from the tile
 *     menu), and
 *   - the expanded lightbox's fixed side panel (`Masonry`), which shows
 *     the same provenance next to the full-size media.
 *
 * The asset row itself only knows dimensions and timestamps, so the
 * provenance (prompt, references, model, tier) is fetched on open via
 * `useAssetDetail` rather than carried in the masonry list — a grid of
 * fifty tiles should not hold fifty prompts in memory.
 */

import { useEffect, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { DownloadSimple, Copy, ArrowCounterClockwise, Heart } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { AssetDetail } from "@clickfy/sdk";
import { getSDK } from "@/lib/api";
import { cn } from "@/lib/utils";

export function useAssetDetail(projectId: string, assetId: string) {
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

  return { detail, failed };
}

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

/**
 * The provenance sections: prompt (or source template), references and
 * the settings table. The prompt block is capped and scrolls — prompts
 * now run to thousands of characters, and an uncapped block pushed
 * everything below it off screen.
 */
export function AssetDetailSections({
  detail,
  failed,
}: {
  detail: AssetDetail | null;
  failed: boolean;
}) {
  const t = useTranslations("studio");
  const format = useFormatter();
  const gen = detail?.generation ?? null;
  const roleLabel = (role: string) =>
    role === "start_frame"
      ? t("startFrameRole")
      : role === "end_frame"
        ? t("endFrameRole")
        : t("referenceRole");

  if (failed) {
    return <p className="mt-4 text-xs text-muted-foreground">{t("detailsUnavailable")}</p>;
  }
  if (!detail) {
    return (
      <div className="mt-4 space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* A file placed from My Assets has no prompt and no settings
          behind it — sections simply don't render. A template's prompt
          is ours, not the user's, so it is never shown. */}
      {detail.generation && (
        <>
          {gen?.prompt ? (
            <section className="mt-4">
              <p className="mb-1.5 text-xs text-muted-foreground">{t("prompt")}</p>
              <p className="nice-scroll max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-foreground">
                {gen.prompt}
              </p>
            </section>
          ) : gen?.templateTitle ? (
            <section className="mt-4">
              <p className="mb-1.5 text-xs text-muted-foreground">{t("madeWithTemplate")}</p>
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
            {detail.format && <Row label={t("format")} value={detail.format.toUpperCase()} />}
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
    </>
  );
}

/** The action row: favorite / download / copy prompt / re-use. */
export function AssetDetailActions({
  detail,
  favorited,
  onToggleFavorite,
  onDownload,
  onReuse,
}: {
  detail: AssetDetail | null;
  /**
   * Heart state is read from the studio's live asset cache rather than
   * the fetched detail, so toggling it here and toggling it on the tile
   * behind the panel never disagree.
   */
  favorited: boolean;
  onToggleFavorite: () => void;
  onDownload: () => void;
  onReuse: (detail: AssetDetail) => void;
}) {
  const t = useTranslations("studio");
  const gen = detail?.generation ?? null;

  return (
    <div className="flex flex-wrap gap-2">
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
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-black transition-opacity hover:opacity-90"
          >
            <ArrowCounterClockwise className="size-4" /> {t("reuse")}
          </button>
        </>
      )}
    </div>
  );
}
