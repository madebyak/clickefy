"use client";

/**
 * One-Click AI Ad — product images in, a 15-second commercial out.
 *
 * The user adds one to five images of the product, picks Reels (vertical)
 * or HD (horizontal), optionally leaves a note, and presses the button.
 * Everything else happens on the server: a vision model writes the
 * Seedance prompt from the images, the job is created, and the clip lands
 * on the canvas as a pending tile. The prompt is never shown.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { FilmSlate, Plus, X } from "@phosphor-icons/react";
import { toast } from "sonner";

import { JobSubmissionError, RateLimitedError } from "@clickfy/sdk";

import { ToolModal } from "@/components/tools/tool-modal";
import { useStudioMaybe } from "@/components/studio/studio-context";
import { getSDK } from "@/lib/api";
import { cn } from "@/lib/utils";

type Orientation = "reels" | "hd";
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_MB = 25;

type Picked = {
  id: string;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  media?: { r2Key: string; mimeType: string; sizeBytes: number };
};

export function AdModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("tools");
  const studio = useStudioMaybe();
  const { isLoaded, isSignedIn } = useAuth();
  const quote = useQuery({
    queryKey: ["tools", "ad", "quote"],
    queryFn: () => getSDK().tools.adQuote(),
    enabled: isLoaded && !!isSignedIn,
    staleTime: 60_000,
  });
  const maxImages = quote.data?.maxImages ?? 5;
  const maxNote = quote.data?.maxNoteChars ?? 1000;

  const [images, setImages] = useState<Picked[]>([]);
  const [orientation, setOrientation] = useState<Orientation>("reels");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Object URLs are released when the modal goes.
  const urlsRef = useRef<string[]>([]);
  useEffect(() => () => { urlsRef.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = maxImages - images.length;
    const accepted = Array.from(files).filter((f) => {
      if (!ACCEPTED.includes(f.type)) { toast.error(t("adUnsupportedImage")); return false; }
      if (f.size > MAX_MB * 1024 * 1024) { toast.error(t("adImageTooLarge", { max: MAX_MB })); return false; }
      return true;
    }).slice(0, Math.max(0, room));
    if (accepted.length === 0) return;
    const picked: Picked[] = accepted.map((f) => {
      const previewUrl = URL.createObjectURL(f);
      urlsRef.current.push(previewUrl);
      return { id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 8)}`, previewUrl, status: "uploading" as const };
    });
    setImages((prev) => [...prev, ...picked]);
    picked.forEach((p, i) => {
      const file = accepted[i]!;
      getSDK().uploads
        .uploadUserAsset({ file, name: file.name, type: file.type, sizeBytes: file.size })
        .then((ref) => setImages((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "ready", media: { r2Key: ref.key, mimeType: ref.contentType, sizeBytes: ref.sizeBytes } } : x))))
        .catch(() => {
          setImages((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "error" } : x)));
          toast.error(t("uploadFailed"));
        });
    });
  };

  const ready = images.filter((i) => i.status === "ready" && i.media);
  const canGenerate = ready.length > 0 && ready.length === images.length && !submitting && !!studio && !!quote.data;

  const onGenerate = async () => {
    if (!canGenerate || !studio) return;
    setSubmitting(true);
    try {
      await studio.startGeneration({
        kind: "video",
        count: 1,
        input: {
          prompt: "",
          tool: { kind: "ad", orientation, ...(notes.trim() ? { notes: notes.trim() } : {}) },
          references: ready.map((i) => ({ kind: "image" as const, ...i.media! })),
        },
      });
      toast.success(t("adStarted"));
      onClose();
    } catch (err) {
      if (err instanceof JobSubmissionError && err.code === "insufficient_credits") toast.error(t("insufficientCredits"));
      else if (err instanceof RateLimitedError) toast.error(t("rateLimited", { seconds: err.retryAfterSeconds }));
      else if (err instanceof JobSubmissionError && err.message) toast.error(err.message);
      else toast.error(t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ToolModal
      title={t("adTitle")}
      icon={<span className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary"><FilmSlate weight="fill" className="size-4" /></span>}
      onClose={onClose}
      panelClassName="max-w-xl"
    >
      <div className="space-y-5 overflow-y-auto p-5">
        <p className="text-sm text-muted-foreground">{t("adIntro")}</p>

        {/* Images */}
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">{t("adImages")}</p>
            <p className="text-xs text-muted-foreground">{t("adImagesHint", { max: maxImages })}</p>
          </div>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {images.map((img) => (
              <div key={img.id} className="group relative aspect-square overflow-hidden rounded-lg bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.previewUrl} alt="" className={cn("size-full object-cover", img.status !== "ready" && "opacity-50")} />
                {img.status === "uploading" && <span className="absolute inset-0 grid place-items-center text-[10px] text-white">{t("uploading")}</span>}
                {img.status === "error" && <span className="absolute inset-0 grid place-items-center bg-destructive/40 text-[10px] text-white">{t("uploadFailed")}</span>}
                <button
                  type="button"
                  aria-label={t("adRemoveImage")}
                  onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                  className="absolute end-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {images.length < maxImages && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="grid aspect-square place-items-center rounded-lg border border-dashed border-white/15 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <Plus className="size-5" />
              </button>
            )}
          </div>
          <input ref={inputRef} type="file" accept={ACCEPTED.join(",")} multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        </div>

        {/* Shape */}
        <div>
          <p className="text-sm font-medium">{t("adShape")}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["reels", "hd"] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOrientation(o)}
                className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5 text-start transition-colors", orientation === o ? "border-primary bg-primary/10" : "border-border bg-surface-1 hover:border-white/20")}
              >
                <span className={cn("shrink-0 rounded-sm border border-current", o === "reels" ? "h-6 w-3.5" : "h-3.5 w-6")} />
                <span>
                  <span className="block text-sm font-medium">{t(o === "reels" ? "adReels" : "adHd")}</span>
                  <span className="block text-xs text-muted-foreground">{t(o === "reels" ? "adReelsSub" : "adHdSub")}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Note */}
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">{t("adNotes")}</p>
            <p className="text-xs tabular-nums text-muted-foreground">{notes.length} / {maxNote}</p>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, maxNote))}
            placeholder={t("adNotesPlaceholder")}
            rows={2}
            dir="auto"
            className="mt-2 w-full resize-none rounded-lg bg-surface-2 p-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            {quote.data ? t("adSpec", { seconds: quote.data.durationSeconds, tier: quote.data.tier }) : ""}
          </p>
          <button
            type="button"
            disabled={!canGenerate}
            onClick={onGenerate}
            className="flex h-10 min-w-[13rem] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-semibold text-black disabled:opacity-40"
          >
            {submitting ? t("adWorking") : quote.data ? t("adGenerate", { credits: quote.data.credits }) : t("adTitle")}
          </button>
        </div>
      </div>
    </ToolModal>
  );
}
