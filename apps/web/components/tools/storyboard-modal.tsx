"use client";

/**
 * Storyboard — one clean-frames sheet from a script.
 *
 * The user pastes a script or an idea, picks a visual style and a grid;
 * the expert-storyboard prompt is engineered server-side around their
 * script and never shown. Generating goes through the studio's normal
 * create path (`tool: {kind: 'storyboard'}`); the sheet arrives as a
 * pending tile in the project grid.
 *
 * Grids are capped at 12 panels on purpose: the sheet is ONE image, so
 * every panel divides the model's resolution budget — beyond 12 the
 * frames go soft.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Sparkle, SquaresFour } from "@phosphor-icons/react";
import { JobSubmissionError, RateLimitedError } from "@clickfy/sdk";
import type { CreateToolInput } from "@clickfy/sdk";
import { cn } from "@/lib/utils";
import { useModels } from "@/lib/use-models";
import { useStudioMaybe } from "@/components/studio/studio-context";
import { ToolModal } from "@/components/tools/tool-modal";

const MAX_SCRIPT_CHARS = 4000;

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
  const [submitting, setSubmitting] = useState(false);

  const canGenerate = script.trim().length > 0 && !submitting && !!studio;

  const onGenerate = async () => {
    if (!canGenerate) return;
    setSubmitting(true);
    try {
      await studio!.startGeneration({
        kind: "image",
        count: 1,
        input: {
          prompt: script.trim(),
          tool: { kind: "storyboard", style, cols: grid.cols, rows: grid.rows },
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
            className="nice-scroll max-h-48 min-h-28 w-full resize-y rounded-lg border border-border bg-surface-2 p-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
          />
        </div>

        {/* style */}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{t("styleLabel")}</span>
          <div className="grid grid-cols-5 gap-2.5">
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
          <div className="grid grid-cols-4 gap-2.5">
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
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3.5">
        <span className="text-xs text-muted-foreground">{t("sheetNote")}</span>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? t("generating") : t("generate")}
          <Sparkle weight="fill" className="size-4" />
          {price != null && <span className="tabular-nums">{price}</span>}
        </button>
      </div>
    </ToolModal>
  );
}
