"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Plus,
  Minus,
  Check,
  CaretDown,
  GoogleLogo,
  Diamond,
  Timer,
  PencilSimple,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Asset } from "@/components/studio/studio-context";

/* --------------------------------------------------------------------- data */

const ASPECTS = ["Auto", "1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "5:4", "4:5", "21:9"];
const QUALITIES: { label: string; premium?: boolean }[] = [
  { label: "1K" },
  { label: "2K" },
  { label: "4K", premium: true },
];
const DURATIONS: { label: string; premium?: boolean }[] = [
  { label: "5s" },
  { label: "10s" },
  { label: "15s", premium: true },
];
const IMAGE_MODELS = [
  { id: "nano-pro", name: "Nano Banana Pro" },
  { id: "nano-2", name: "Nano Banana 2 Flash" },
  { id: "seedream", name: "Seedream" },
];
const VIDEO_MODELS = [
  { id: "kling-omni", name: "Kling 3 Omni" },
  { id: "kling-26", name: "Kling 2.6" },
  { id: "seedance", name: "Seedance 2" },
  { id: "veo", name: "Veo 3" },
];
const MAX_OUTPUTS = 4;
const CREDIT_COST = 2;

/* ------------------------------------------------------------------ atoms */

function RatioGlyph({ ratio, className }: { ratio: string; className?: string }) {
  if (ratio === "Auto") {
    return <span className={cn("size-4 rounded-[3px] border-[1.5px] border-dashed border-current", className)} />;
  }
  const [w, h] = ratio.split(":").map(Number);
  const scale = 16 / Math.max(w, h);
  return (
    <span
      className={cn("rounded-[3px] border-[1.5px] border-current", className)}
      style={{ width: w * scale, height: h * scale }}
    />
  );
}

function Pill({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border bg-surface-3 px-3 text-sm text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1",
        active ? "border-border" : "border-transparent",
        className,
      )}
      {...props}
    />
  );
}

/* --------------------------------------------------------------- dropdown */

function Dropdown({
  trigger,
  panelClassName,
  children,
}: {
  trigger: (s: { open: boolean; toggle: () => void }) => ReactNode;
  panelClassName?: string;
  children: (h: { close: () => void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={cn(
            "absolute bottom-full start-0 z-50 mb-2 rounded-xl border border-border bg-surface-3 p-1.5 shadow-2xl shadow-black/50",
            panelClassName,
          )}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}

function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{children}</p>;
}

function MenuItem({
  selected,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/5",
        selected ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
      {selected && <Check weight="bold" className="ms-auto size-4 text-foreground" />}
    </button>
  );
}

/* ------------------------------------------------------------ typewriter */

/**
 * Animated placeholder text: types a phrase, holds, deletes, moves to the next,
 * with a blinking caret. Runs only while `active` (field idle + empty); when it
 * flips off, the display clears so the caller can show a static placeholder.
 * Honors prefers-reduced-motion by showing the first phrase without animating.
 */
function useTypewriterPlaceholder(phrases: string[], active: boolean) {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    if (!active) {
      setDisplay("");
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(phrases[0]);
      return;
    }

    let phraseIndex = 0;
    let charIndex = 0;
    let deleting = false;
    let caretOn = true;
    let typeTimer: ReturnType<typeof setTimeout>;

    const render = () => {
      const phrase = phrases[phraseIndex];
      setDisplay(phrase.slice(0, charIndex) + (caretOn ? "▏" : ""));
    };

    const tick = () => {
      const phrase = phrases[phraseIndex];
      if (!deleting) {
        charIndex += 1;
        if (charIndex >= phrase.length) {
          deleting = true;
          typeTimer = setTimeout(tick, 1600); // hold on the full phrase
        } else {
          typeTimer = setTimeout(tick, 55);
        }
      } else {
        charIndex -= 1;
        if (charIndex <= 0) {
          charIndex = 0;
          deleting = false;
          phraseIndex = (phraseIndex + 1) % phrases.length;
          typeTimer = setTimeout(tick, 350); // pause before the next phrase
        } else {
          typeTimer = setTimeout(tick, 28);
        }
      }
      render();
    };

    const caretTimer = setInterval(() => {
      caretOn = !caretOn;
      render();
    }, 530);

    render();
    typeTimer = setTimeout(tick, 350);

    return () => {
      clearTimeout(typeTimer);
      clearInterval(caretTimer);
    };
  }, [active, phrases]);

  return display;
}

/* --------------------------------------------------------------- component */

export function PromptBar({
  kind = "image",
  attachments,
  onRemoveAttachment,
}: {
  kind?: "image" | "video";
  attachments?: Asset[];
  onRemoveAttachment?: (id: string) => void;
} = {}) {
  const t = useTranslations("promptbar");
  const isVideo = kind === "video";
  const MODELS = isVideo ? VIDEO_MODELS : IMAGE_MODELS;
  const SETTINGS = isVideo ? DURATIONS : QUALITIES;

  const [model, setModel] = useState(MODELS[0]);
  const [aspect, setAspect] = useState(isVideo ? "16:9" : "3:4");
  const [setting, setSetting] = useState(SETTINGS[0].label);
  const [count, setCount] = useState(1);
  const [draw, setDraw] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [focused, setFocused] = useState(false);
  const basePlaceholder = t(isVideo ? "placeholderVideo" : "placeholderImage");
  const examples = useMemo(
    () => t.raw(isVideo ? "examplesVideo" : "examplesImage") as string[],
    [t, isVideo],
  );
  // Animate only while the field is idle and empty; static hint once focused.
  const animate = !focused && prompt.length === 0;
  const animatedPlaceholder = useTypewriterPlaceholder(examples, animate);

  const hasAttachments = !!attachments && attachments.length > 0;

  return (
    <div className="rounded-2xl bg-surface-1 p-3">
      {/* attachments strip */}
      {hasAttachments && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments!.map((a) => (
            <div key={a.id} className="group/att relative size-14 overflow-hidden rounded-lg bg-surface-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.poster ?? a.src} alt="" className="size-full object-cover" />
              <button
                type="button"
                aria-label={t("removeAttachment")}
                onClick={() => onRemoveAttachment?.(a.id)}
                className="absolute end-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-black/75 text-white transition-colors hover:bg-black"
              >
                <X className="size-2.5" weight="bold" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* prompt row */}
          <div className="flex items-start gap-2">
            <button
              type="button"
              aria-label={t("addReference")}
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
            >
              <Plus className="size-5" />
            </button>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={animate ? animatedPlaceholder : basePlaceholder}
              // Direction follows the typed content (or placeholder when empty),
              // independent of the site locale: English → LTR, Arabic → RTL.
              dir="auto"
              rows={1}
              className="mt-1.5 max-h-40 w-full resize-none bg-transparent text-start text-sm text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
            />
          </div>

          {/* controls row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* model */}
            <Dropdown
              panelClassName="min-w-60"
              trigger={({ toggle }) => (
                <Pill onClick={toggle}>
                  <GoogleLogo weight="bold" className="size-4 text-accent-turquoise" />
                  {model.name}
                  <CaretDown className="size-3.5 text-muted-foreground" />
                </Pill>
              )}
            >
              {({ close }) => (
                <>
                  <MenuLabel>{t("model")}</MenuLabel>
                  {MODELS.map((m) => (
                    <MenuItem
                      key={m.id}
                      selected={m.id === model.id}
                      onClick={() => {
                        setModel(m);
                        close();
                      }}
                    >
                      <GoogleLogo weight="bold" className="size-4 text-accent-turquoise" />
                      {m.name}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>

            {/* aspect */}
            <Dropdown
              panelClassName="max-h-80 min-w-44 overflow-y-auto"
              trigger={({ toggle }) => (
                <Pill onClick={toggle}>
                  <RatioGlyph ratio={aspect} className="text-muted-foreground" />
                  {aspect}
                </Pill>
              )}
            >
              {({ close }) => (
                <>
                  <MenuLabel>{t("aspectRatio")}</MenuLabel>
                  {ASPECTS.map((a) => (
                    <MenuItem
                      key={a}
                      selected={a === aspect}
                      onClick={() => {
                        setAspect(a);
                        close();
                      }}
                    >
                      <span className="grid w-4 place-items-center">
                        <RatioGlyph ratio={a} />
                      </span>
                      {a}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>

            {/* quality (image) / duration (video) */}
            <Dropdown
              panelClassName="min-w-52"
              trigger={({ toggle }) => (
                <Pill onClick={toggle}>
                  {isVideo ? (
                    <Timer weight="bold" className="size-3.5 text-accent-turquoise" />
                  ) : (
                    <Diamond weight="fill" className="size-3.5 text-accent-turquoise" />
                  )}
                  {setting}
                </Pill>
              )}
            >
              {({ close }) => (
                <>
                  <MenuLabel>{isVideo ? t("duration") : t("quality")}</MenuLabel>
                  {SETTINGS.map((q) => (
                    <MenuItem
                      key={q.label}
                      selected={q.label === setting}
                      onClick={() => {
                        setSetting(q.label);
                        close();
                      }}
                    >
                      {q.label}
                      {q.premium && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                          {t("premium")}
                        </span>
                      )}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>

            {/* output count */}
            <div className="inline-flex h-9 items-center rounded-lg bg-surface-3 px-1">
              <button
                type="button"
                aria-label={t("fewer")}
                onClick={() => setCount((c) => Math.max(1, c - 1))}
                disabled={count <= 1}
                className="grid size-7 place-items-center rounded-md text-foreground outline-none transition-colors hover:bg-white/5 disabled:opacity-30"
              >
                <Minus className="size-4" />
              </button>
              <span className="min-w-11 text-center text-sm tabular-nums text-muted-foreground">
                {count}/{MAX_OUTPUTS}
              </span>
              <button
                type="button"
                aria-label={t("more")}
                onClick={() => setCount((c) => Math.min(MAX_OUTPUTS, c + 1))}
                disabled={count >= MAX_OUTPUTS}
                className="grid size-7 place-items-center rounded-md text-foreground outline-none transition-colors hover:bg-white/5 disabled:opacity-30"
              >
                <Plus className="size-4" />
              </button>
            </div>

            {/* draw */}
            <Pill active={draw} onClick={() => setDraw((d) => !d)}>
              <PencilSimple className="size-4" />
              {t("draw")}
            </Pill>
          </div>
        </div>

        {/* generate */}
        <button
          type="button"
          className="flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 sm:h-auto sm:w-auto sm:self-stretch"
        >
          {t("generate")}
          <Sparkle weight="fill" className="size-4" />
          <span className="tabular-nums">{CREDIT_COST * count}</span>
        </button>
      </div>
    </div>
  );
}
