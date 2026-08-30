"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  Plus,
  Minus,
  Check,
  CaretDown,
  Diamond,
  Timer,
  PencilSimple,
  Sparkle,
  ImageSquare,
  VideoCamera,
  SpeakerHigh,
  SpeakerSlash,
  Warning,
  X,
  FilmStrip,
  ImagesSquare,
  PencilSimpleLine,
  FastForward,
} from "@phosphor-icons/react";
import { resolveCreditCost } from "@clickfy/types";
import type { GenModel } from "@clickfy/sdk";
import { JobSubmissionError, RateLimitedError } from "@clickfy/sdk";
import { cn } from "@/lib/utils";
import { useModels } from "@/lib/use-models";
import {
  ASSET_DRAG_TYPE,
  useStudioMaybe,
  type AttachableAsset,
  type PromptAttachment,
} from "@/components/studio/studio-context";
import { MyAssetsModal } from "@/components/media/my-assets-modal";
import { DrawModal } from "@/components/generate/draw-modal";
import { modelLogo } from "@/lib/model-logos";

/* ------------------------------------------------------------------ atoms */

/** Mirrors the file input's `accept`; also enforced on drop. */
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Seedance reference-clip formats (models with the matching budget). */
const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const ACCEPTED_AUDIO_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"];

const PROVIDER_STYLE: Record<string, string> = {
  gemini: "bg-accent-turquoise/20 text-accent-turquoise",
  kling: "bg-brand-purple/25 text-[#b98aff]",
  seedance: "bg-accent-pink/20 text-accent-pink",
  openai: "bg-white/10 text-white",
};

/**
 * Brand mark for a model. Falls back to the old tinted initial when we
 * have no logo for the provider (e.g. a model added server-side before
 * its asset ships) — the picker must never render an empty square.
 */
function ProviderBadge({
  provider,
  modelKey,
  className,
}: {
  provider: string;
  modelKey?: string;
  className?: string;
}) {
  const logo = modelLogo({ provider, modelKey });
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        aria-hidden
        className={cn("size-4 shrink-0 object-contain text-foreground", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded text-[10px] font-bold uppercase",
        PROVIDER_STYLE[provider] ?? "bg-surface-2 text-muted-foreground",
        className,
      )}
    >
      {provider.charAt(0)}
    </span>
  );
}

function RatioGlyph({ ratio, className }: { ratio: string; className?: string }) {
  if (ratio === "Auto") {
    return <span className={cn("size-4 rounded-[3px] border-[1.5px] border-dashed border-current", className)} />;
  }
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return <span className={cn("size-4 rounded-[3px] border-[1.5px] border-current", className)} />;
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

/* ------------------------------------------------------------ attachment */

/**
 * A single labelled frame slot (start / end).
 *
 * Frames are positional on every provider that supports them, so the UI
 * has to say which is which — dropping two images into an unlabelled
 * strip and hoping the order is right is how you get a video that runs
 * backwards.
 */
function FrameSlot({
  label,
  hint,
  attachment,
  onPick,
  onRemove,
  removeLabel,
  disabled,
  compact,
}: {
  label: string;
  hint?: string;
  attachment?: PromptAttachment;
  onPick: () => void;
  onRemove: () => void;
  removeLabel: string;
  disabled?: boolean;
  /** Tighter box for narrow viewports. */
  compact?: boolean;
}) {
  const box = compact ? "size-16" : "size-20";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {attachment ? (
        <div
          className={cn(
            "group/att relative overflow-hidden rounded-xl border border-border bg-surface-3",
            box,
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachment.previewUrl}
            alt=""
            className={cn(
              "size-full object-cover transition-opacity",
              attachment.status !== "ready" && "opacity-40",
            )}
          />
          {attachment.status === "uploading" && (
            <div className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-black/50">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.round(attachment.progress * 100)}%` }}
              />
            </div>
          )}
          {attachment.status === "error" && (
            <div className="absolute inset-0 grid place-items-center bg-black/50">
              <Warning weight="fill" className="size-4 text-status-red" />
            </div>
          )}
          <button
            type="button"
            aria-label={removeLabel}
            onClick={onRemove}
            className="absolute end-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover/att:opacity-100 focus-visible:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          className={cn(
            "grid place-items-center rounded-xl border border-dashed border-border bg-surface-3/50 text-muted-foreground outline-none transition-colors hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:opacity-30 disabled:hover:border-border",
            box,
          )}
        >
          <Plus className={compact ? "size-4" : "size-5"} />
        </button>
      )}
    </div>
  );
}

function AttachmentThumb({
  attachment,
  onRemove,
  removeLabel,
  compact,
}: {
  attachment: PromptAttachment;
  onRemove: () => void;
  removeLabel: string;
  compact?: boolean;
}) {
  // Audio has no frame to show — a labelled chip beats a broken <img>.
  if (attachment.kind === "audio") {
    return (
      <div
        className={cn(
          "group/att relative flex items-center gap-1.5 overflow-hidden rounded-lg bg-surface-3 px-2",
          compact ? "h-11 max-w-32" : "h-14 max-w-40",
          attachment.status !== "ready" && "opacity-60",
        )}
      >
        <SpeakerHigh weight="fill" className="size-4 shrink-0 text-accent-turquoise" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
          {attachment.name ?? "audio"}
        </span>
        {attachment.durationSec != null && (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {Math.round(attachment.durationSec)}s
          </span>
        )}
        {attachment.status === "error" && (
          <Warning weight="fill" className="size-3.5 shrink-0 text-status-red" />
        )}
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="grid size-4 shrink-0 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-black"
        >
          <X className="size-2.5" weight="bold" />
        </button>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "group/att relative overflow-hidden rounded-lg bg-surface-3",
        compact ? "size-11" : "size-14",
      )}
    >
      {attachment.kind === "video" ? (
        <video
          src={attachment.previewUrl}
          muted
          playsInline
          preload="metadata"
          className={cn(
            "size-full object-cover transition-opacity",
            attachment.status !== "ready" && "opacity-40",
          )}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.previewUrl}
          alt=""
          className={cn(
            "size-full object-cover transition-opacity",
            attachment.status !== "ready" && "opacity-40",
          )}
        />
      )}
      {attachment.kind === "video" && attachment.durationSec != null && (
        <span className="pointer-events-none absolute bottom-0.5 start-0.5 rounded bg-black/70 px-1 text-[9px] tabular-nums text-white">
          {Math.round(attachment.durationSec)}s
        </span>
      )}
      {attachment.status === "uploading" && (
        <div className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-black/50">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${Math.round(attachment.progress * 100)}%` }}
          />
        </div>
      )}
      {attachment.status === "error" && (
        <div className="absolute inset-0 grid place-items-center bg-black/50">
          <Warning weight="fill" className="size-4 text-status-red" />
        </div>
      )}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="absolute end-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-black/75 text-white transition-colors hover:bg-black"
      >
        <X className="size-2.5" weight="bold" />
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- component */

/**
 * `size` scales the composer without forking it — the marketing hero and
 * the studio render THE SAME component so the two can never drift apart
 * visually or behaviourally. `compact` steps every control down one notch
 * (pills 36→32px, generate 44→36px, thumbs 56→44px) for the hero card,
 * where the bar sits under a headline rather than being the primary
 * surface. Everything else — controls, model roster, behaviour — is
 * identical.
 */
export function PromptBar({
  kind = "image",
  size = "default",
  animatedPlaceholder = false,
}: {
  kind?: "image" | "video";
  size?: "default" | "compact";
  /**
   * Cycle example prompts as a typewriter while the field is idle.
   *
   * This is marketing copy: on the homepage it shows a visitor what the
   * product can do. Inside the studio the user already knows, and text
   * that types and deletes itself next to the box they are trying to
   * think in is a distraction — so the studio gets a plain, static hint.
   */
  animatedPlaceholder?: boolean;
} = {}) {
  const t = useTranslations("promptbar");
  const compact = size === "compact";
  // Class overrides rather than conditional markup: `cn` runs tailwind-merge,
  // so these reliably beat the base utilities they conflict with.
  const pillCls = compact ? "h-8 gap-1.5 px-2.5 text-xs" : undefined;
  const router = useRouter();
  const localeDir = useLocale() === "ar" ? "rtl" : "ltr";
  const { isLoaded, isSignedIn } = useAuth();
  const [mode, setMode] = useState<"image" | "video">(kind);
  const isVideo = mode === "video";

  // `useState(kind)` only seeds the FIRST render. /create and
  // /create-video share this component at the same position in the tree,
  // so a client-side nav between them re-renders rather than remounts —
  // the composer would stay on whichever mode it was opened with, and
  // "Create Video" in the navbar would land on the image composer.
  // Syncing on the prop fixes that without fighting the user's own
  // toggle, since `kind` only ever changes on a route change.
  useEffect(() => {
    setMode(kind);
  }, [kind]);

  const { models, isLoading: modelsLoading } = useModels(mode);
  // Null on the marketing page (no StudioProvider) — the bar then acts
  // as a CTA into the studio instead of generating in place.
  const studio = useStudioMaybe();
  const attachments = studio?.attachments ?? [];

  // Selected model tracked by key so it survives roster refetches.
  const [modelKey, setModelKey] = useState<string | null>(null);
  const model: GenModel | null =
    models.find((m) => m.modelKey === modelKey) ?? models[0] ?? null;

  const [aspect, setAspect] = useState("Auto");
  const [duration, setDuration] = useState<number | null>(null);
  // Tier keys are provider vocabulary, not a fixed set: Kling speaks
  // std/pro/4k, Gemini speaks 512/1K/2K/4K, GPT Image speaks low/medium/high.
  // The roster is the authority on which keys are valid for a model.
  const [tier, setTier] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const [count, setCount] = useState(1);
  const [drawOpen, setDrawOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /**
   * Which kind of input the user is supplying.
   *
   * Some models accept only one kind; Seedance accepts frames OR
   * references but forbids mixing them in a single request, so this is
   * a choice rather than coexisting affordances. `edit` / `extend` are
   * Seedance 2.5's omni sub-tasks: a source video plus an instruction
   * prompt, riding the same reference plumbing.
   */
  const [attachMode, setAttachMode] = useState<
    "frames" | "references" | "edit" | "extend"
  >("references");

  const MAX_OUTPUTS = 4;
  // Video providers (Kling) REQUIRE an explicit aspect ratio for
  // text-to-video — "Auto" is an image-only affordance. Offering it on
  // video caused provider 400s with the credits already debited.
  const aspects = useMemo(
    () =>
      model?.kind === "video"
        ? (model?.aspectRatios ?? [])
        : ["Auto", ...(model?.aspectRatios ?? [])],
    [model],
  );

  // When the mode flips, fall back to that roster's first model. Draw is
  // image-only, so a modal left open would survive onto a surface whose
  // button no longer exists.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setModelKey(null);
    setDrawOpen(false);
  }, [isVideo]);

  // Snap dependent knobs to the selected model's capabilities.
  const activeModelKey = model?.modelKey;
  useEffect(() => {
    if (!model) return;
    setAspect((prev) => {
      if (model.kind === "video") {
        // No "Auto" on video — snap to a concrete, supported ratio.
        return model.aspectRatios.includes(prev)
          ? prev
          : (model.aspectRatios[0] ?? "16:9");
      }
      return prev !== "Auto" && !model.aspectRatios.includes(prev) ? "Auto" : prev;
    });
    setDuration((prev) =>
      model.durations.length === 0
        ? null
        : prev != null && model.durations.includes(prev)
          ? prev
          : model.durations[0],
    );
    setTier(model.tiers?.length ? (model.defaultTier ?? model.tiers[0].mode) : null);
    setSound(false);
    // Snap to the mode this model actually supports. "seedance" means it
    // offers both, in which case frames is the safer default: it is what
    // the previous build always sent, so behaviour is unchanged until the
    // user deliberately switches.
    setAttachMode(model.attachments === "references" ? "references" : "frames");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the model identity, not the object
  }, [activeModelKey]);

  const [prompt, setPrompt] = useState("");

  // ── Re-use: restore a past generation's setup ────────────────────
  //
  // Three commits, because each step invalidates the next:
  //
  //   1. MODE   — `useModels(mode)` filters the roster by image/video, so
  //               a video model is not even in the list until the mode
  //               flips. Flipping it also resets the selected model.
  //   2. MODEL  — selecting a model resets its dependent knobs (aspect,
  //               duration, tier, sound) from that model's defaults.
  //   3. KNOBS  — only now can the restored values survive.
  //
  // Collapsing these would let each reset wipe what the previous step
  // just wrote, which is how re-using a video used to land in the image
  // composer with an image model.
  //
  // ⚠️ These three effects MUST stay declared below the mode-flip and
  // model-change effects above. React runs effects in declaration order
  // within a commit, and that is precisely what lets a restore overwrite
  // the reset it races. Move this block up and re-use breaks silently.
  const pendingSetup = studio?.pendingSetup ?? null;
  const clearPendingSetup = studio?.clearPendingSetup;
  const [setupStage, setSetupStage] = useState<"idle" | "mode" | "model" | "knobs">("idle");

  useEffect(() => {
    if (pendingSetup && setupStage === "idle") setSetupStage("mode");
  }, [pendingSetup, setupStage]);

  useEffect(() => {
    if (!pendingSetup || setupStage !== "mode") return;
    setPrompt(pendingSetup.prompt);
    setMode(pendingSetup.kind);
    setSetupStage("model");
  }, [pendingSetup, setupStage]);

  useEffect(() => {
    if (!pendingSetup || setupStage !== "model") return;
    // Wait for the roster of the NEW mode to arrive; picking from a
    // stale list would fail the lookup exactly as before.
    if (modelsLoading) return;
    if (pendingSetup.modelKey && models.some((m) => m.modelKey === pendingSetup.modelKey)) {
      setModelKey(pendingSetup.modelKey);
    }
    setSetupStage("knobs");
  }, [pendingSetup, setupStage, models, modelsLoading]);

  useEffect(() => {
    if (!pendingSetup || setupStage !== "knobs") return;
    if (pendingSetup.aspectRatio) setAspect(pendingSetup.aspectRatio);
    if (pendingSetup.quality) setTier(pendingSetup.quality);
    if (pendingSetup.duration != null) setDuration(pendingSetup.duration);
    if (pendingSetup.sound != null) setSound(pendingSetup.sound);
    for (const url of pendingSetup.referenceUrls) {
      studio?.addAttachment({ id: `reuse-${url}`, type: "image", src: url });
    }
    setSetupStage("idle");
    clearPendingSetup?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per restore
  }, [pendingSetup, setupStage]);

  const [focused, setFocused] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const basePlaceholder = t(isVideo ? "placeholderVideo" : "placeholderImage");
  const examples = useMemo(
    () => t.raw(isVideo ? "examplesVideo" : "examplesImage") as string[],
    [t, isVideo],
  );
  // Animate only while the field is idle and empty; static hint once
  // focused — and only at all where the caller asked for it.
  const animate = animatedPlaceholder && !focused && prompt.length === 0;
  const typedPlaceholder = useTypewriterPlaceholder(examples, animate);

  const selectedTier = model?.tiers?.find((x) => x.mode === tier) ?? null;
  // Native audio that can't play at the selected tier (Kling 2.6 is
  // 1080p-only): the server drops the audio rather than upgrading the
  // billed resolution, so the toggle is gated instead of lying.
  const soundGated = !!model?.soundRequiresTier && tier !== model.soundRequiresTier;
  const soundTierLabel =
    model?.tiers?.find((x) => x.mode === model.soundRequiresTier)?.label ??
    model?.soundRequiresTier ??
    "";
  const readyAttachments = attachments.filter((a) => a.status === "ready");
  const uploadsInFlight = attachments.some((a) => a.status === "uploading");
  const maxImages = model?.maxImages ?? 0;
  // Reference-clip budgets (Seedance). Zero when the model takes none.
  const maxVideoRefs = model?.referenceVideo?.max ?? 0;
  const maxAudioRefs = model?.referenceAudio?.max ?? 0;
  const needsStartFrame = !!model?.requiresStartFrame && readyAttachments.length === 0;

  // A model offering "seedance" accepts either kind, so the user picks;
  // the others are fixed and the dropdown is hidden.
  const modeIsChoosable = model?.attachments === "seedance";
  const isTask = modeIsChoosable && (attachMode === "edit" || attachMode === "extend");
  const isFrames = model ? (modeIsChoosable ? attachMode === "frames" : model.attachments !== "references") : false;
  // Edit works on exactly one source clip; extend chains up to the
  // model's video budget.
  const effMaxVideos = attachMode === "edit" ? Math.min(1, maxVideoRefs) : maxVideoRefs;

  // Task modes need their source clip before anything can run.
  const needsTaskVideo =
    isTask && !readyAttachments.some((a) => a.kind === "video");
  const canGenerate =
    !!model &&
    prompt.trim().length > 0 &&
    !submitting &&
    !uploadsInFlight &&
    !needsStartFrame &&
    !needsTaskVideo;

  // Video references are billed by their length (Seedance). The
  // client-probed durations preview the charge; the server derives the
  // authoritative figure from the uploaded bytes.
  const videoSecondsAttached = attachments.reduce(
    (sum, a) => (a.kind === "video" ? sum + (a.durationSec ?? 0) : sum),
    0,
  );
  // Same resolver the server bills with, so the number on the button is
  // the number charged. The map carries the `${tier}_audio` keys so a
  // sound-on Kling job prices at the audio rate; edit tasks bill the
  // source clip's length as the output term, exactly like the server.
  const costPerJob = model
    ? resolveCreditCost({
        baseCredits: model.costCredits,
        tierPricing: model.tiers
          ? Object.fromEntries(
              model.tiers.flatMap((t) => [
                [t.mode, t.costCredits] as [string, number],
                ...(t.soundCostCredits != null
                  ? [[`${t.mode}_audio`, t.soundCostCredits] as [string, number]]
                  : []),
              ]),
            )
          : null,
        mode: tier,
        sound: sound && !soundGated,
        duration:
          attachMode === "edit" && isTask
            ? Math.max(1, Math.ceil(videoSecondsAttached))
            : duration,
        defaultDuration: model.defaultDuration,
        inputVideoSeconds: videoSecondsAttached,
        inputVideoFactor: model.inputVideoFactor,
      })
    : 0;

  /**
   * Single validated entry point for attachments — used by both the file
   * picker and drag-and-drop. Drops can carry anything (PDFs, folders,
   * dragged page images), so the MIME filter lives here rather than
   * relying on the input's `accept`, which only constrains the picker.
   */
  const addFiles = (incoming: File[]) => {
    if (!model || !studio || incoming.length === 0) return;
    // Frames are images by definition; references also take video/audio
    // clips on models with the matching budget (Seedance). Task modes
    // (edit/extend) take video + optional images, no audio.
    const videoOk = !isFrames && effMaxVideos > 0;
    const audioOk = !isFrames && !isTask && maxAudioRefs > 0;
    const usable = incoming.filter(
      (f) =>
        ACCEPTED_IMAGE_TYPES.includes(f.type) ||
        (videoOk && ACCEPTED_VIDEO_TYPES.includes(f.type)) ||
        (audioOk && ACCEPTED_AUDIO_TYPES.includes(f.type)),
    );
    if (usable.length < incoming.length) toast.error(t("unsupportedFileType"));
    if (usable.length === 0) return;

    // Total room first, then the per-kind clip caps — a Seedance 2.5
    // request can carry 30 images but only 10 video / 10 audio clips.
    let room = Math.max(0, attachCeiling - attachments.length);
    let videoRoom = Math.max(
      0,
      effMaxVideos - attachments.filter((a) => a.kind === "video").length,
    );
    let audioRoom = Math.max(
      0,
      maxAudioRefs - attachments.filter((a) => a.kind === "audio").length,
    );
    let dropped = false;
    for (const f of usable) {
      if (room <= 0) {
        dropped = true;
        break;
      }
      if (ACCEPTED_VIDEO_TYPES.includes(f.type)) {
        if (videoRoom <= 0) {
          toast.error(t("maxVideoRefs", { max: effMaxVideos }));
          continue;
        }
        videoRoom -= 1;
      } else if (ACCEPTED_AUDIO_TYPES.includes(f.type)) {
        if (audioRoom <= 0) {
          toast.error(t("maxAudioRefs", { max: maxAudioRefs }));
          continue;
        }
        audioRoom -= 1;
      }
      room -= 1;
      studio.attachFile(f);
    }
    if (dropped) toast.error(t("maxAttachments", { max: attachCeiling }));
  };

  const onPickFiles = (files: FileList | null) => {
    if (files) addFiles(Array.from(files));
  };

  /* ------------------------------------------------------- drag & drop */

  // Enter/leave fire for every child element the pointer crosses, so a
  // plain boolean flickers. Track depth and only clear at zero.
  const dragDepth = useRef(0);
  // Frames take at most two images regardless of the model's total
  // budget; references sum the image budget with the model's video and
  // audio clip budgets (Seedance); task modes drop audio and cap videos
  // per the sub-task.
  const attachCeiling = isFrames
    ? model?.supportsEndFrame
      ? 2
      : 1
    : maxImages + effMaxVideos + (isTask ? 0 : maxAudioRefs);
  // A start frame pins the output shape on these providers — the ratio
  // picker would be a control that does nothing, so it locks instead.
  const aspectLocked =
    !!model?.aspectLockedByStartFrame && isFrames && !!attachments[0];

  // Kling O1: a bare start frame (no end frame) collapses the legal
  // durations — filter the picker and snap the selection.
  const bareFrameCollapse =
    !!model?.bareStartFrameDurations && isFrames && !!attachments[0] && !attachments[1];
  const availableDurations = bareFrameCollapse
    ? (model!.durations.filter((d) => model!.bareStartFrameDurations!.includes(d)) ?? [])
    : (model?.durations ?? []);
  useEffect(() => {
    if (!bareFrameCollapse || duration == null) return;
    if (!availableDurations.includes(duration)) {
      setDuration(availableDurations[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snap once per collapse-state change
  }, [bareFrameCollapse, duration]);

  // Register the selected model's attachment rules with the studio, so
  // every attach entry point the composer does not own (tile buttons,
  // canvas drag-and-drop) validates against the SAME policy and refuses
  // with the same copy. See `AttachmentPolicy` in studio-context.
  const setAttachmentPolicy = studio?.setAttachmentPolicy;
  const modelName = model?.name ?? null;
  const hasModel = !!model;
  useEffect(() => {
    if (!setAttachmentPolicy) return;
    setAttachmentPolicy({
      modelName,
      acceptsImages: hasModel && attachCeiling > 0,
      // Clips ride the references and task modes — frames are images.
      acceptsVideos: !isFrames && effMaxVideos > 0,
      acceptsAudio: !isFrames && !isTask && maxAudioRefs > 0,
      ceiling: attachCeiling,
      maxVideos: isFrames ? 0 : effMaxVideos,
      maxAudio: isFrames || isTask ? 0 : maxAudioRefs,
    });
    return () => setAttachmentPolicy(null);
  }, [setAttachmentPolicy, modelName, hasModel, attachCeiling, isFrames, isTask, effMaxVideos, maxAudioRefs]);
  const canAttach = !!model && !!studio && attachments.length < attachCeiling;
  // Only react to actual file drags — ignore text/link drags.
  const isFileDrag = (e: React.DragEvent) => e.dataTransfer?.types?.includes("Files");
  // Canvas tiles dragged from the masonry carry their asset as a typed
  // payload (see ASSET_DRAG_TYPE). Always accepted as a DROP TARGET —
  // even over the ceiling or with a video on an image model — because
  // `addAttachment` owns the refusal and explains it; a drop the browser
  // rejects silently teaches the user the feature doesn't exist.
  const isAssetDrag = (e: React.DragEvent) =>
    e.dataTransfer?.types?.includes(ASSET_DRAG_TYPE);
  const isDroppable = (e: React.DragEvent) =>
    (canAttach && isFileDrag(e)) || (!!studio && isAssetDrag(e));

  const dragHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!isDroppable(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!isDroppable(e)) return;
      e.preventDefault(); // required, or the browser opens the file instead
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!isFileDrag(e) && !isAssetDrag(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!isDroppable(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      if (isAssetDrag(e)) {
        try {
          const asset = JSON.parse(
            e.dataTransfer.getData(ASSET_DRAG_TYPE),
          ) as AttachableAsset;
          if (asset?.id && asset.src) studio?.addAttachment(asset);
        } catch {
          // Malformed payload — nothing sensible to attach.
        }
        return;
      }
      addFiles(Array.from(e.dataTransfer.files));
    },
  };

  const onGenerate = async () => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }
    if (!studio) {
      // Marketing hero: hand off to the studio surface for this mode.
      router.push(isVideo ? "/create-video" : "/create");
      return;
    }
    if (!model || !canGenerate) return;

    const media = readyAttachments.map((a) => ({ kind: a.kind, ...a.media! }));
    const frames = isFrames;
    // Frames mode only ever holds images (policy + accept list enforce
    // it); the filter is what proves that to the type system.
    const frameMedia = readyAttachments
      .filter((a) => a.kind === "image")
      .map((a) => ({ kind: "image" as const, ...a.media! }));
    setSubmitting(true);
    try {
      await studio.startGeneration({
        kind: model.kind,
        count,
        input: {
          modelKey: model.modelKey,
          prompt: prompt.trim().slice(0, model.maxPromptChars),
          // Task requests pin the ratio to the source clip (adaptive on
          // the wire); edit output length follows the clip too.
          aspectRatio: isTask || aspect === "Auto" ? undefined : aspect,
          duration:
            model.kind === "video" && attachMode !== "edit"
              ? (duration ?? undefined)
              : undefined,
          quality: tier ?? undefined,
          sound: model.supportsSound ? sound && !soundGated : undefined,
          task: isTask ? (attachMode as "edit" | "extend") : undefined,
          references: frames ? undefined : media,
          startFrame: frames ? frameMedia[0] : undefined,
          endFrame: frames && model.supportsEndFrame ? frameMedia[1] : undefined,
        },
      });
      toast.success(t("generationStarted", { count }));
    } catch (err) {
      if (err instanceof JobSubmissionError && err.code === "insufficient_credits") {
        toast.error(t("insufficientCredits"));
      } else if (err instanceof RateLimitedError) {
        toast.error(t("rateLimited", { seconds: err.retryAfterSeconds }));
      } else if (err instanceof JobSubmissionError && err.httpStatus === 422 && err.message) {
        // Validation refusals (clip too long, wrong mix, …) carry a
        // human sentence from the server — far more actionable than the
        // generic failure line.
        toast.error(err.message);
      } else {
        toast.error(t("submitFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      {...dragHandlers}
      className={cn(
        "relative rounded-2xl bg-surface-1 transition-colors",
        compact ? "p-2.5" : "p-3",
        dragActive && "ring-2 ring-primary",
      )}
    >
      {/* Drop affordance. pointer-events-none so it can't swallow the drop
          event from the container underneath. */}
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-background/80 backdrop-blur-[1px]">
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <ImageSquare weight="fill" className="size-4" />
            {t("dropToAttach")}
          </p>
        </div>
      )}

      {/* image / video mode toggle */}
      <div className={cn("inline-flex items-center gap-1 rounded-xl bg-surface-3 p-1", compact ? "mb-2" : "mb-3")}>
        {(["image", "video"] as const).map((m) => {
          const active = mode === m;
          const Icon = m === "video" ? VideoCamera : ImageSquare;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-3",
                compact ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
                active
                  ? m === "video"
                    ? "bg-brand-purple text-white"
                    : "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon weight={active ? "fill" : "regular"} className="size-4" />
              {t(m)}
            </button>
          );
        })}
      </div>

      {/* ── image inputs ────────────────────────────────────────────
          Frames mode renders two labelled slots because frame order is
          semantic; references mode renders a flat grid because order
          there is not. Only one is ever shown: every provider that
          supports both forbids mixing them in one request. */}
      {isFrames ? (
        <div className="mb-3 flex flex-wrap items-start gap-3">
          <FrameSlot
            compact={compact}
            label={t("startFrame")}
            attachment={attachments[0]}
            onPick={() => fileInput.current?.click()}
            onRemove={() => attachments[0] && studio?.removeAttachment(attachments[0].id)}
            removeLabel={t("removeAttachment")}
            disabled={!canAttach}
          />
          {model?.supportsEndFrame && (
            <FrameSlot
              compact={compact}
              label={t("endFrame")}
              hint={t("optional")}
              attachment={attachments[1]}
              onPick={() => fileInput.current?.click()}
              onRemove={() => attachments[1] && studio?.removeAttachment(attachments[1].id)}
              removeLabel={t("removeAttachment")}
              // An end frame without a start frame is not supported by any
              // provider we target, so the second slot stays shut until the
              // first is filled.
              disabled={!canAttach || !attachments[0]}
            />
          )}
        </div>
      ) : (
        attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <AttachmentThumb
                compact={compact}
                key={a.id}
                attachment={a}
                onRemove={() => studio?.removeAttachment(a.id)}
                removeLabel={t("removeAttachment")}
              />
            ))}
          </div>
        )
      )}

      {/* start-frame hint (image-to-video models) */}
      {model?.requiresStartFrame && readyAttachments.length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">{t("startFrameNeeded")}</p>
      )}
      {/* task-mode hint: the source clip is the whole point */}
      {needsTaskVideo && (
        <p className="mb-2 text-xs text-muted-foreground">
          {t(attachMode === "edit" ? "editNeedsVideo" : "extendNeedsVideo")}
        </p>
      )}

      <div className={cn("flex flex-col sm:flex-row", compact ? "gap-2" : "gap-3")}>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* prompt row */}
          <div className="flex items-start gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={[
                ...ACCEPTED_IMAGE_TYPES,
                ...(!isFrames && maxVideoRefs > 0 ? ACCEPTED_VIDEO_TYPES : []),
                ...(!isFrames && maxAudioRefs > 0 ? ACCEPTED_AUDIO_TYPES : []),
              ].join(",")}
              multiple={!isFrames}
              className="hidden"
              onChange={(e) => {
                onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {/* Two ways to add a reference, so + is a menu rather than a
                single action. Uploading and re-using something already
                uploaded are equally common, and burying the second behind
                its own control makes the library something people forget
                they have. */}
            <div className="relative shrink-0" hidden={isFrames}>
              <button
                type="button"
                aria-label={t("addReference")}
                aria-expanded={attachMenuOpen}
                disabled={!model || attachments.length >= attachCeiling}
                onClick={() => setAttachMenuOpen((v) => !v)}
                className={cn(
                  "grid shrink-0 place-items-center rounded-lg bg-surface-3 text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:opacity-30",
                  compact ? "size-8" : "size-9",
                )}
              >
                <Plus className={compact ? "size-4" : "size-5"} />
              </button>

              {attachMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setAttachMenuOpen(false)}
                    aria-hidden
                  />
                  <div className="absolute bottom-full start-0 z-50 mb-2 w-56 overflow-hidden rounded-xl bg-surface-3 py-1 shadow-lg ring-1 ring-white/10">
                    <button
                      type="button"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        fileInput.current?.click();
                      }}
                      className="block w-full px-3 py-2 text-start text-sm transition-colors hover:bg-surface-2"
                    >
                      {t("uploadImage")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        setAssetsOpen(true);
                      }}
                      className="block w-full px-3 py-2 text-start text-sm transition-colors hover:bg-surface-2"
                    >
                      {t("importFromAssets")}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* The library, in pick mode. Mounted here so it sits in the
                same subtree as the composer it feeds; <dialog> renders in
                the browser's top layer regardless of where it lives. */}
            <MyAssetsModal
              open={assetsOpen}
              onClose={() => setAssetsOpen(false)}
              mode="pick"
              pickDisabledReason={
                attachCeiling === 0 ? t("modelTakesNoReferences") : null
              }
              onPick={(picked) => {
                // Images always; videos too on models with a clip budget
                // (Seedance references). `addAttachment` re-validates
                // per-kind, so this filter is UX, not enforcement.
                const videoOk = !isFrames && maxVideoRefs > 0;
                const usable = picked.filter(
                  (a) => a.kind === "image" || (videoOk && a.kind === "video"),
                );
                if (usable.length < picked.length) {
                  toast.error(t("videoNotAReference"));
                }
                if (usable.length === 0) return;

                // Attach up to the model's ceiling and say what was left
                // behind. Silently dropping the tail of a multi-select is
                // the kind of thing people only notice after generating.
                const room = Math.max(0, attachCeiling - attachments.length);
                if (room === 0) {
                  toast.error(t("maxAttachments", { max: attachCeiling }));
                  return;
                }
                usable.slice(0, room).forEach((a) =>
                  studio?.addAttachment({ id: a.id, type: a.kind, src: a.url }),
                );
                if (usable.length > room) {
                  toast.info(t("attachedSome", { added: room, max: attachCeiling }));
                }
                setAssetsOpen(false);
              }}
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              maxLength={model?.maxPromptChars}
              placeholder={animate ? typedPlaceholder : basePlaceholder}
              // Once the user types, direction follows the content (English → LTR,
              // Arabic → RTL) regardless of locale. While empty, the placeholder is
              // in the site language, so follow the locale direction.
              dir={prompt.length > 0 ? "auto" : localeDir}
              rows={1}
              className={cn("w-full resize-none bg-transparent text-start text-sm text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground", compact ? "mt-1 max-h-28" : "mt-1.5 max-h-40")}
            />
          </div>

          {/* controls row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* input mode — only for models that accept both kinds and
                forbid mixing them (Seedance). Fixed-mode models get no
                control, because there is nothing to decide. */}
            {modeIsChoosable && (
              <Dropdown
                panelClassName="min-w-72"
                trigger={({ toggle }) => {
                  const TriggerIcon =
                    attachMode === "frames"
                      ? FilmStrip
                      : attachMode === "edit"
                        ? PencilSimpleLine
                        : attachMode === "extend"
                          ? FastForward
                          : ImagesSquare;
                  return (
                    <Pill onClick={toggle} active className={pillCls}>
                      <TriggerIcon className="size-4" />
                      {t(
                        attachMode === "frames"
                          ? "modeFrames"
                          : attachMode === "edit"
                            ? "modeEdit"
                            : attachMode === "extend"
                              ? "modeExtend"
                              : "modeReferences",
                      )}
                      <CaretDown className="size-3.5 text-muted-foreground" />
                    </Pill>
                  );
                }}
              >
                {({ close }) => (
                  <>
                    <MenuLabel>{t("attachMode")}</MenuLabel>
                    {(
                      [
                        ["frames", "modeFrames", "modeFramesHint", FilmStrip],
                        ["references", "modeReferences", "modeReferencesHint", ImagesSquare],
                        // Edit/Extend are Seedance 2.5 sub-tasks — only
                        // models declaring the capability show them.
                        ...(model?.supportsVideoTasks
                          ? ([
                              ["edit", "modeEdit", "modeEditHint", PencilSimpleLine],
                              ["extend", "modeExtend", "modeExtendHint", FastForward],
                            ] as const)
                          : []),
                      ] as const
                    ).map(([mode, label, hint, Icon]) => (
                      <MenuItem
                        key={mode}
                        selected={attachMode === mode}
                        onClick={() => {
                          // The modes are mutually exclusive upstream, so
                          // anything already attached belongs to the old
                          // one and cannot carry over.
                          if (attachMode !== mode) {
                            for (const a of attachments) studio?.removeAttachment(a.id);
                          }
                          setAttachMode(mode);
                          close();
                        }}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="flex flex-col items-start text-start">
                          <span>{t(label)}</span>
                          <span className="text-xs text-muted-foreground">{t(hint)}</span>
                        </span>
                      </MenuItem>
                    ))}
                  </>
                )}
              </Dropdown>
            )}

            {/* model */}
            <Dropdown
              panelClassName="min-w-64"
              trigger={({ toggle }) => (
                <Pill onClick={toggle} disabled={modelsLoading && !model} className={pillCls}>
                  {model ? (
                    <>
                      <ProviderBadge provider={model.provider} modelKey={model.modelKey} />
                      {model.name}
                    </>
                  ) : modelsLoading || isSignedIn ? (
                    <span className="h-3.5 w-24 animate-pulse rounded bg-surface-2" />
                  ) : (
                    // Signed out, the roster query is disabled (it needs a
                    // token), so `modelsLoading` is false and no model will
                    // ever arrive. Pulsing forever reads as a broken widget
                    // on the marketing page — say what's actually true.
                    <span className="text-muted-foreground">{t("signInToGenerate")}</span>
                  )}
                  <CaretDown className="size-3.5 text-muted-foreground" />
                </Pill>
              )}
            >
              {({ close }) => (
                <>
                  <MenuLabel>{t("model")}</MenuLabel>
                  {models.map((m) => (
                    <MenuItem
                      key={m.modelKey}
                      selected={m.modelKey === model?.modelKey}
                      onClick={() => {
                        setModelKey(m.modelKey);
                        close();
                      }}
                    >
                      <ProviderBadge provider={m.provider} modelKey={m.modelKey} />
                      <span className="min-w-0 flex-1 truncate text-start">{m.name}</span>
                      <span className="ms-2 text-xs tabular-nums text-muted-foreground">
                        {m.costCredits}
                      </span>
                    </MenuItem>
                  ))}
                  {models.length === 0 && (
                    <p className="px-2 py-2 text-sm text-muted-foreground">
                      {isSignedIn ? "…" : t("signInToGenerate")}
                    </p>
                  )}
                </>
              )}
            </Dropdown>

            {/* aspect. Task modes inherit the source clip's ratio, so
                the control disappears entirely. With a start frame
                attached, providers that derive the frame size from it
                (Kling; Seedance 2.5) ignore an explicit ratio — show
                that instead of a dead dropdown. */}
            {isTask ? null : aspectLocked ? (
              <Pill disabled className={cn(pillCls, "opacity-60")}>
                <RatioGlyph ratio="Auto" className="text-muted-foreground" />
                {t("aspectFromFrame")}
              </Pill>
            ) : (
            <Dropdown
              panelClassName="max-h-80 min-w-44 overflow-y-auto"
              trigger={({ toggle }) => (
                <Pill onClick={toggle} className={pillCls}>
                  <RatioGlyph ratio={aspect} className="text-muted-foreground" />
                  {aspect === "Auto" ? t("auto") : aspect}
                </Pill>
              )}
            >
              {({ close }) => (
                <>
                  <MenuLabel>{t("aspectRatio")}</MenuLabel>
                  {aspects.map((a) => (
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
                      {a === "Auto" ? t("auto") : a}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
            )}

            {/* quality tier (models that price per tier) */}
            {model?.tiers && model.tiers.length > 0 && (
              <Dropdown
                panelClassName="min-w-52"
                trigger={({ toggle }) => (
                  <Pill onClick={toggle} className={pillCls}>
                    <Diamond weight="fill" className="size-3.5 text-accent-turquoise" />
                    {selectedTier?.label ?? tier}
                  </Pill>
                )}
              >
                {({ close }) => (
                  <>
                    <MenuLabel>{t("quality")}</MenuLabel>
                    {model.tiers!.map((q) => (
                      <MenuItem
                        key={q.mode}
                        selected={q.mode === tier}
                        onClick={() => {
                          setTier(q.mode);
                          close();
                        }}
                      >
                        {q.label}
                        <span className="ms-auto text-xs tabular-nums text-muted-foreground">
                          {q.costCredits}
                        </span>
                      </MenuItem>
                    ))}
                  </>
                )}
              </Dropdown>
            )}

            {/* duration (video). Edit output follows the source clip, so
                the picker disappears there. With a bare start frame,
                Kling O1 collapses the legal list (5s/10s) — filter
                rather than offer values the server would have to
                refuse. */}
            {isVideo && attachMode !== "edit" && (model?.durations.length ?? 0) > 0 && (
              <Dropdown
                panelClassName="min-w-40"
                trigger={({ toggle }) => (
                  <Pill onClick={toggle} className={pillCls}>
                    <Timer weight="bold" className="size-3.5 text-accent-turquoise" />
                    {duration != null ? `${duration}s` : "—"}
                  </Pill>
                )}
              >
                {({ close }) => (
                  <>
                    <MenuLabel>{t("duration")}</MenuLabel>
                    {availableDurations.map((d) => (
                      <MenuItem
                        key={d}
                        selected={d === duration}
                        onClick={() => {
                          setDuration(d);
                          close();
                        }}
                      >
                        {d}s
                      </MenuItem>
                    ))}
                  </>
                )}
              </Dropdown>
            )}

            {/* native audio (Kling). Gated tiers keep the pill visible but
                inert — tapping it explains the requirement instead of
                toggling a switch the server would silently ignore. */}
            {model?.supportsSound && (
              <Pill
                active={sound && !soundGated}
                onClick={() => {
                  if (soundGated) {
                    toast.info(t("soundNeedsTier", { tier: soundTierLabel }));
                    return;
                  }
                  setSound((s) => !s);
                }}
                className={cn(pillCls, soundGated && "opacity-50")}
              >
                {sound && !soundGated ? (
                  <SpeakerHigh weight="fill" className="size-4 text-accent-turquoise" />
                ) : (
                  <SpeakerSlash className="size-4" />
                )}
                {t("sound")}
              </Pill>
            )}

            {/* output count */}
            <div className={cn("inline-flex items-center rounded-lg bg-surface-3 px-1", compact ? "h-8" : "h-9")}>
              <button
                type="button"
                aria-label={t("fewer")}
                onClick={() => setCount((c) => Math.max(1, c - 1))}
                disabled={count <= 1}
                className={cn("grid place-items-center rounded-md text-foreground outline-none transition-colors hover:bg-white/5 disabled:opacity-30", compact ? "size-6" : "size-7")}
              >
                <Minus className={compact ? "size-3.5" : "size-4"} />
              </button>
              <span className={cn("text-center tabular-nums text-muted-foreground", compact ? "min-w-9 text-xs" : "min-w-11 text-sm")}>
                {count}/{MAX_OUTPUTS}
              </span>
              <button
                type="button"
                aria-label={t("more")}
                onClick={() => setCount((c) => Math.min(MAX_OUTPUTS, c + 1))}
                disabled={count >= MAX_OUTPUTS}
                className={cn("grid place-items-center rounded-md text-foreground outline-none transition-colors hover:bg-white/5 disabled:opacity-30", compact ? "size-6" : "size-7")}
              >
                <Plus className="size-4" />
              </button>
            </div>

            {/* draw — image-only; there's no draw surface for video */}
            {!isVideo && (
              <Pill active={drawOpen} onClick={() => setDrawOpen(true)} className={pillCls}>
                <PencilSimple className="size-4" />
                {t("draw")}
              </Pill>
            )}
          </div>
        </div>

        {/* generate */}
        <button
          type="button"
          onClick={onGenerate}
          // Outside the studio (marketing hero) the button is a plain CTA;
          // inside, it gates on prompt/attachment/upload readiness.
          disabled={!isLoaded || (!!studio && !!isSignedIn && !canGenerate)}
          className={cn(
            // A fixed height on desktop rather than self-stretching to the
            // full prompt-bar height, which made it read as an oversized
            // block. It sits one step above the control pills (44/36px at
            // default, 36/32px compact) and aligns to the bottom of the
            // column so it lines up with that row.
            "flex w-full shrink-0 items-center justify-center gap-2 rounded-xl font-semibold outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:opacity-40 sm:w-auto sm:self-end",
            compact ? "h-9 px-4 text-sm" : "h-11 px-6",
            isVideo ? "bg-brand-purple text-white" : "bg-primary text-primary-foreground",
          )}
        >
          {submitting ? t("generating") : t("generate")}
          {isVideo ? (
            <VideoCamera weight="fill" className="size-4" />
          ) : (
            <Sparkle weight="fill" className="size-4" />
          )}
          {costPerJob > 0 && <span className="tabular-nums">{costPerJob * count}</span>}
        </button>
      </div>

      {/* Draw. The annotated PNG goes back through `addFiles` rather than
          straight to `attachFile`, so it obeys the same per-model
          attachment ceiling as a dragged-in file. */}
      {!isVideo && (
        <DrawModal
          open={drawOpen}
          onClose={() => setDrawOpen(false)}
          sources={readyAttachments.map((a) => ({ id: a.id, url: a.previewUrl }))}
          onSave={(file) => addFiles([file])}
        />
      )}
    </div>
  );
}
