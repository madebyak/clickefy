"use client";

/**
 * Storyboard — one clean-frames sheet from a script.
 *
 * The user pastes a script or an idea, picks a visual style and a grid,
 * and may attach photos of the characters, products or places the sheet
 * must keep consistent (with a note saying which is which); the
 * expert-storyboard prompt is engineered server-side around their
 * script and never shown. Generating goes through the studio's normal
 * create path (`tool: {kind: 'storyboard'}`); the sheet arrives as a
 * pending tile in the project grid.
 *
 * Grids are capped at 12 panels on purpose: the sheet is ONE image, so
 * every panel divides the model's resolution budget — beyond 12 the
 * frames go soft.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Sparkle, SquaresFour, X } from "@phosphor-icons/react";
import { JobSubmissionError, RateLimitedError } from "@clickfy/sdk";
import type { CreateToolInput } from "@clickfy/sdk";
import { cn } from "@/lib/utils";
import { getSDK } from "@/lib/api";
import { useModels } from "@/lib/use-models";
import { useStudioMaybe } from "@/components/studio/studio-context";
import { ToolModal } from "@/components/tools/tool-modal";

const MAX_SCRIPT_CHARS = 4000;
const MAX_NOTES_CHARS = 1000;
/** Mirrors STORYBOARD_MAX_IMAGES in the API's job validation. */
const MAX_IMAGES = 6;
const MAX_MB = 25;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

type Picked = {
  id: string;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  media?: { r2Key: string; mimeType: string; sizeBytes: number };
};

type Style = Extract<CreateToolInput, { kind: "storyboard" }>["style"];

const STYLES: readonly Style[] = ["hand_drawn", "sketch", "realistic", "comic", "3d"];

const GRIDS: ReadonlyArray<{ cols: number; rows: number }> = [
  { cols: 2, rows: 2 },
  { cols: 3, rows: 2 },
  { cols: 3, rows: 3 },
  { cols: 4, rows: 3 },
];

/** One example frame per style (public/tools/storyboard) — pick with the eyes, not by reading. */
const STYLE_IMAGE: Record<Style, string> = {
  hand_drawn: "/tools/storyboard/hand-drawn.webp",
  sketch: "/tools/storyboard/sketch.webp",
  realistic: "/tools/storyboard/realistic.webp",
  comic: "/tools/storyboard/comic.webp",
  "3d": "/tools/storyboard/3d.webp",
};

function StyleSample({ style }: { style: Style }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={STYLE_IMAGE[style]} alt="" className="h-16 w-full rounded-lg object-cover" />
  );
}

const STYLE_LABEL_KEY: Record<Style, string> = {
  hand_drawn: "styleHandDrawn",
  sketch: "styleSketch",
  realistic: "styleRealistic",
  comic: "styleComic",
  "3d": "style3d",
};

export function StoryboardModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("tools");
  const studio = useStudioMaybe();
  const { models } = useModels("image");
  // Mirrors TOOL_MODELS.storyboard in providers/tool-prompts.ts
  // (Nano Banana Pro at 4K) — price display only; the server decides.
  const price = models
    .find((m) => m.modelKey === "gemini-3-pro-image")
    ?.tiers?.find((x) => x.mode === "4K")?.costCredits;

  const [script, setScript] = useState("");
  const [style, setStyle] = useState<Style>("hand_drawn");
  const [grid, setGrid] = useState(GRIDS[2]!);
  const [images, setImages] = useState<Picked[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Object URLs are released when the modal goes.
  const urlsRef = useRef<string[]>([]);
  useEffect(() => () => { urlsRef.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  // Same upload path as the Ad tool: straight to My Assets, then the
  // stored key rides the request as a reference image.
  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_IMAGES - images.length;
    const accepted = Array.from(files).filter((f) => {
      if (!ACCEPTED.includes(f.type)) { toast.error(t("unsupportedPhoto")); return false; }
      if (f.size > MAX_MB * 1024 * 1024) { toast.error(t("photoTooLarge", { max: MAX_MB })); return false; }
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
  // Every attached image must have landed — a half-uploaded cast would
  // silently drop a character from the sheet.
  const canGenerate =
    script.trim().length > 0 && !submitting && !!studio && ready.length === images.length;

  const onGenerate = async () => {
    if (!canGenerate) return;
    setSubmitting(true);
    try {
      await studio!.startGeneration({
        kind: "image",
        count: 1,
        input: {
          prompt: script.trim(),
          tool: {
            kind: "storyboard",
            style,
            cols: grid.cols,
            rows: grid.rows,
            notes: ready.length > 0 && notes.trim() ? notes.trim() : undefined,
          },
          references: ready.length > 0 ? ready.map((i) => ({ kind: "image" as const, ...i.media! })) : undefined,
        },
      });
      toast.success(t("storyboardStarted"));
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
      title={t("storyboard")}
      onClose={onClose}
      panelClassName="max-w-xl"
      icon={
        <span className="grid size-7 place-items-center rounded-lg bg-brand-purple/20">
          <SquaresFour weight="fill" className="size-4 text-[#b98aff]" />
        </span>
      }
    >
      <div className="flex flex-col gap-5 overflow-y-auto p-5">
        {/* script */}
        <div className="flex flex-col gap-2">
          <label htmlFor="storyboard-script" className="text-xs text-muted-foreground">
            {t("scriptLabel")}
          </label>
          <textarea
            id="storyboard-script"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            maxLength={MAX_SCRIPT_CHARS}
            rows={5}
            dir="auto"
            placeholder={t("scriptPlaceholder")}
            className="nice-scroll max-h-48 min-h-28 w-full resize-y rounded-lg border border-border bg-surface-2 p-3 text-base leading-relaxed sm:text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
          />
        </div>

        {/* characters & products — optional reference images + a note saying which is which */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">{t("storyboardImages")}</span>
            <span className="text-xs text-muted-foreground">{t("storyboardImagesHint", { max: MAX_IMAGES })}</span>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED.join(",")}
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="grid grid-cols-6 gap-2">
            {images.map((img, i) => (
              <div key={img.id} className="group relative aspect-square overflow-hidden rounded-lg bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.previewUrl} alt="" className={cn("size-full object-cover", img.status !== "ready" && "opacity-50")} />
                {/* The number is what the note refers to ("Image 2 is the product"). */}
                <span className="absolute start-1 bottom-1 rounded bg-black/70 px-1 text-[10px] font-semibold tabular-nums text-white">
                  {i + 1}
                </span>
                {img.status === "uploading" && <span className="absolute inset-0 grid place-items-center text-[10px] text-white">{t("uploading")}</span>}
                {img.status === "error" && <span className="absolute inset-0 grid place-items-center bg-destructive/40 text-[10px] text-white">{t("uploadFailed")}</span>}
                <button
                  type="button"
                  aria-label={t("storyboardRemoveImage")}
                  onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                  className="absolute end-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {images.length < MAX_IMAGES && (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                aria-label={t("storyboardAddImage")}
                className="grid aspect-square place-items-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
              >
                <Plus className="size-5" />
              </button>
            )}
          </div>
          {images.length > 0 && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={MAX_NOTES_CHARS}
              rows={2}
              dir="auto"
              placeholder={t("storyboardNotesPlaceholder")}
              aria-label={t("storyboardNotes")}
              className="nice-scroll max-h-32 min-h-16 w-full resize-y rounded-lg border border-border bg-surface-2 p-3 text-base leading-relaxed sm:text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
            />
          )}
        </div>

        {/* style */}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{t("styleLabel")}</span>
          <div className="grid grid-cols-2 gap-2.5 min-[400px]:grid-cols-3 sm:grid-cols-5">
            {STYLES.map((s) => (
              <button key={s} type="button" onClick={() => setStyle(s)} className="group flex flex-col gap-1.5 outline-none">
                <span
                  className={cn(
                    "overflow-hidden rounded-lg border border-transparent transition-shadow",
                    style === s
                      ? "ring-2 ring-primary"
                      : "border-border group-hover:ring-1 group-hover:ring-white/20",
                  )}
                >
                  <StyleSample style={s} />
                </span>
                <span
                  className={cn(
                    "text-center text-[11px]",
                    style === s ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {t(STYLE_LABEL_KEY[s])}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* grid */}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{t("shotsLabel")}</span>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {GRIDS.map((g) => {
              const selected = grid.cols === g.cols && grid.rows === g.rows;
              return (
                <button
                  key={`${g.cols}x${g.rows}`}
                  type="button"
                  onClick={() => setGrid(g)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border bg-surface-2 py-3 outline-none transition-shadow",
                    selected
                      ? "border-transparent ring-2 ring-primary"
                      : "border-border hover:ring-1 hover:ring-white/20",
                  )}
                >
                  <span
                    className="grid gap-[3px]"
                    style={{ gridTemplateColumns: `repeat(${g.cols}, 14px)` }}
                  >
                    {Array.from({ length: g.cols * g.rows }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          "h-2.5 rounded-[2px]",
                          selected ? "bg-primary" : "bg-border",
                        )}
                      />
                    ))}
                  </span>
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      selected ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {t("shotsCount", { count: g.cols * g.rows })}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="flex shrink-0 flex-col items-stretch justify-between gap-3 border-t sm:flex-row sm:items-center border-border px-5 py-3.5">
        <span className="text-xs text-muted-foreground">{t("sheetNote")}</span>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? t("generating") : t("generate")}
          <Sparkle weight="fill" className="size-4" />
          {price != null && <span className="tabular-nums">{price}</span>}
        </button>
      </div>
    </ToolModal>
  );
}
