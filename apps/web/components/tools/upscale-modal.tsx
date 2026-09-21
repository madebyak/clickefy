"use client";

/**
 * Video Upscaler — take a clip and make it bigger.
 *
 * TWO WAYS IN, ONE MODAL. Opened empty it shows an upload box; opened
 * with a clip from the project grid it skips straight to the options.
 * Same component either way, the way Camera Angle already handles a
 * tile-supplied photo.
 *
 * THE PRICE MOVES, which is why the options only appear after the file
 * does. fal bills the SOURCE duration — flat, whatever you upscale to —
 * so a 10-second clip is 2 credits and a minute is 12, and there is no
 * honest number to show before we know how long the video is. The
 * browser reads the duration from the file's metadata for display; the
 * server probes it again for the charge, because a number the client
 * supplies is a number the client can change.
 *
 * RESOLUTION DOES NOT CHANGE THE PRICE. Verified against a real invoice
 * line rather than assumed, so the picker is purely a quality choice and
 * the credit cost stays put as you move between 1080p and 4K.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowsOutSimple, FilmStrip, Sparkle } from "@phosphor-icons/react";

import { ToolModal } from "@/components/tools/tool-modal";
import { useStudioMaybe } from "@/components/studio/studio-context";
import { useModels } from "@/lib/use-models";
import { getSDK } from "@/lib/api";
import { JobSubmissionError, RateLimitedError } from "@clickfy/sdk";
import { cn } from "@/lib/utils";

/** A clip handed to the tool from an existing tile. */
export type ToolVideo = { id: string; src: string };

const MODEL_KEY = "bytedance-upscaler";
const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_MB = 200;
/** Mirrors `referenceVideo.maxClipSeconds` on the model. */
const MAX_SECONDS = 60;

type Source = {
  previewUrl: string;
  status: "reading" | "uploading" | "ready" | "error";
  /** From the file's own metadata — display only; the server re-probes. */
  seconds?: number;
  width?: number;
  height?: number;
  media?: { r2Key: string; mimeType: string; sizeBytes: number };
};

export function UpscaleModal({
  initialVideo,
  onClose,
}: {
  initialVideo: ToolVideo | null;
  onClose: () => void;
}) {
  const t = useTranslations("tools");
  const studio = useStudioMaybe();
  // `allModels`, not `models`: this one is deliberately absent from the
  // composer's picker, and its price still has to come from the roster.
  const { allModels } = useModels("video");
  const model = allModels.find((m) => m.modelKey === MODEL_KEY);

  const [source, setSource] = useState<Source | null>(null);
  const [target, setTarget] = useState<string>("1080p");
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const resolutions = model?.tiers?.map((x) => x.mode) ?? ["1080p", "2k", "4k"];

  /**
   * The price, from the catalogue rather than from a constant here.
   *
   * `costCredits` is quoted at the model's reference length (5s) and the
   * server scales it by the real duration, so the estimate below has to
   * scale the same way or the button would promise one number and the
   * charge would be another.
   */
  const perReference = model?.costCredits ?? null;
  const referenceSeconds = model?.defaultDuration ?? 5;
  const price =
    perReference != null && source?.seconds
      ? Math.max(perReference, Math.ceil((perReference * source.seconds) / referenceSeconds))
      : null;

  const setFromBlob = useCallback(
    (blob: Blob, name: string) => {
      if (blob.size > MAX_MB * 1024 * 1024) {
        toast.error(t("videoTooLarge", { max: MAX_MB }));
        return;
      }
      const previewUrl = URL.createObjectURL(blob);
      setSource({ previewUrl, status: "reading" });

      // Read duration and shape before uploading: a clip that is too long
      // should be refused here rather than after a 200MB upload.
      const probe = document.createElement("video");
      probe.preload = "metadata";
      probe.onloadedmetadata = () => {
        const seconds = Math.round(probe.duration);
        if (!Number.isFinite(probe.duration) || seconds <= 0) {
          setSource((prev) => (prev?.previewUrl === previewUrl ? { ...prev, status: "error" } : prev));
          toast.error(t("videoUnreadable"));
          return;
        }
        if (seconds > MAX_SECONDS) {
          setSource(null);
          URL.revokeObjectURL(previewUrl);
          toast.error(t("videoTooLong", { max: MAX_SECONDS }));
          return;
        }
        setSource((prev) =>
          prev?.previewUrl === previewUrl
            ? {
                ...prev,
                status: "uploading",
                seconds,
                width: probe.videoWidth,
                height: probe.videoHeight,
              }
            : prev,
        );
        getSDK()
          .uploads.uploadUserAsset({
            file: blob,
            name,
            type: blob.type || "video/mp4",
            sizeBytes: blob.size,
          })
          .then((ref) =>
            setSource((prev) =>
              prev?.previewUrl === previewUrl
                ? {
                    ...prev,
                    status: "ready",
                    media: { r2Key: ref.key, mimeType: ref.contentType, sizeBytes: ref.sizeBytes },
                  }
                : prev,
            ),
          )
          .catch((err: unknown) => {
            setSource((prev) =>
              prev?.previewUrl === previewUrl ? { ...prev, status: "error" } : prev,
            );
            const message = err instanceof Error ? err.message : "";
            toast.error(message && message.length <= 120 ? message : t("uploadFailed"));
          });
      };
      probe.onerror = () => {
        setSource((prev) => (prev?.previewUrl === previewUrl ? { ...prev, status: "error" } : prev));
        toast.error(t("videoUnreadable"));
      };
      probe.src = previewUrl;
    },
    [t],
  );

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error(t("unsupportedVideo"));
      return;
    }
    setFromBlob(file, file.name);
  };

  // A tile-supplied clip is a served URL — pull the bytes and upload them
  // like any other reference, so the job gets a real r2Key.
  const loadedInitial = useRef(false);
  useEffect(() => {
    if (!initialVideo || loadedInitial.current) return;
    loadedInitial.current = true;
    fetch(initialVideo.src)
      .then((res) => {
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        return res.blob();
      })
      .then((blob) => setFromBlob(blob, initialVideo.src.split("/").pop() ?? "clip.mp4"))
      .catch(() => toast.error(t("uploadFailed")));
  }, [initialVideo, setFromBlob, t]);

  const canGenerate = source?.status === "ready" && !!source.media && !submitting && !!studio;

  const onGenerate = async () => {
    if (!canGenerate || !source?.media) return;
    setSubmitting(true);
    try {
      await studio!.startGeneration({
        kind: "video",
        count: 1,
        input: {
          modelKey: MODEL_KEY,
          // The model reads no prompt; the server exempts models whose
          // `maxPromptChars` is 0 from the "say something" rule.
          prompt: "",
          quality: target,
          references: [{ kind: "video", ...source.media }],
        },
      });
      toast.success(t("upscaleStarted"));
      onClose();
    } catch (err) {
      if (err instanceof JobSubmissionError && err.code === "insufficient_credits") {
        toast.error(t("insufficientCredits"));
      } else if (err instanceof RateLimitedError) {
        toast.error(t("rateLimited", { seconds: err.retryAfterSeconds }));
      } else if (err instanceof JobSubmissionError && err.httpStatus === 422 && err.message) {
        toast.error(err.message);
      } else {
        toast.error(t("submitFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ToolModal
      title={t("upscaleTitle")}
      icon={<ArrowsOutSimple weight="bold" className="size-4 text-accent-turquoise" />}
      onClose={onClose}
      panelClassName="w-[min(34rem,calc(100vw-2rem))]"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {!source ? (
          /* Empty state — the upload box. */
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-1 text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          >
            <FilmStrip className="size-7" />
            <span className="text-sm font-medium">{t("uploadVideo")}</span>
            <span className="text-xs">{t("uploadVideoHint", { max: MAX_SECONDS })}</span>
          </button>
        ) : (
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                src={source.previewUrl}
                muted
                playsInline
                loop
                autoPlay
                className={cn(
                  "max-h-56 w-full object-contain transition-opacity",
                  source.status !== "ready" && "opacity-50",
                )}
              />
              {source.seconds != null && (
                <span className="absolute end-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs tabular-nums text-white">
                  {source.width}×{source.height} · {source.seconds}s
                </span>
              )}
              {source.status !== "ready" && (
                <span className="absolute inset-x-0 bottom-2 text-center text-xs text-white/80">
                  {source.status === "error" ? t("uploadFailed") : t("preparing")}
                </span>
              )}
            </div>

            <div>
              <p className="text-sm font-medium">{t("upscaleTo")}</p>
              {/* Every option costs the same: fal charges for the source
                  clip's length, not the size we return. */}
              <p className="mt-0.5 text-xs text-muted-foreground">{t("upscaleSamePrice")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {resolutions.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTarget(r)}
                    className={cn(
                      "rounded-lg border px-4 py-2 text-sm transition-colors",
                      target === r
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(source.previewUrl);
                setSource(null);
              }}
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {t("chooseAnother")}
            </button>
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            onPickFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5 sm:py-3.5">
        {/* The wait is minutes, not seconds — saying so here is kinder
            than letting someone sit and watch a tile. */}
        <span className="hidden truncate text-xs text-muted-foreground sm:block">
          {t("upscaleNote")}
        </span>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 sm:px-6"
        >
          {submitting ? t("generating") : t("upscale")}
          <Sparkle weight="fill" className="size-4" />
          {price != null && <span className="tabular-nums">{price}</span>}
        </button>
      </div>
    </ToolModal>
  );
}
