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
} from "@phosphor-icons/react";
import type { GenModel } from "@clickfy/sdk";
import { JobSubmissionError, RateLimitedError } from "@clickfy/sdk";
import { cn } from "@/lib/utils";
import { useModels } from "@/lib/use-models";
import { useStudioMaybe, type PromptAttachment } from "@/components/studio/studio-context";

/* ------------------------------------------------------------------ atoms */

const PROVIDER_STYLE: Record<string, string> = {
  gemini: "bg-accent-turquoise/20 text-accent-turquoise",
  kling: "bg-brand-purple/25 text-[#b98aff]",
  seedance: "bg-accent-pink/20 text-accent-pink",
};

function ProviderBadge({ provider, className }: { provider: string; className?: string }) {
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

function AttachmentThumb({
  attachment,
  onRemove,
  removeLabel,
}: {
  attachment: PromptAttachment;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div className="group/att relative size-14 overflow-hidden rounded-lg bg-surface-3">
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

export function PromptBar({ kind = "image" }: { kind?: "image" | "video" } = {}) {
  const t = useTranslations("promptbar");
  const router = useRouter();
  const localeDir = useLocale() === "ar" ? "rtl" : "ltr";
  const { isLoaded, isSignedIn } = useAuth();
  const [mode, setMode] = useState<"image" | "video">(kind);
  const isVideo = mode === "video";

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
  const [tier, setTier] = useState<"std" | "pro" | "4k" | null>(null);
  const [sound, setSound] = useState(false);
  const [count, setCount] = useState(1);
  const [draw, setDraw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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

  // When the mode flips, fall back to that roster's first model.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setModelKey(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the model identity, not the object
  }, [activeModelKey]);

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

  const selectedTier = model?.tiers?.find((x) => x.mode === tier) ?? null;
  const costPerJob = selectedTier?.costCredits ?? model?.costCredits ?? 0;

  const readyAttachments = attachments.filter((a) => a.status === "ready");
  const uploadsInFlight = attachments.some((a) => a.status === "uploading");
  const maxImages = model?.maxImages ?? 0;
  const needsStartFrame = !!model?.requiresStartFrame && readyAttachments.length === 0;

  const canGenerate =
    !!model &&
    prompt.trim().length > 0 &&
    !submitting &&
    !uploadsInFlight &&
    !needsStartFrame;

  const onPickFiles = (files: FileList | null) => {
    if (!files || !model || !studio) return;
    const room = Math.max(0, maxImages - attachments.length);
    if (files.length > room) toast.error(t("maxAttachments", { max: maxImages }));
    Array.from(files)
      .slice(0, room)
      .forEach((f) => studio.attachFile(f));
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

    const media = readyAttachments.map((a) => ({ kind: "image" as const, ...a.media! }));
    const frames = model.attachments !== "references";
    setSubmitting(true);
    try {
      await studio.startGeneration({
        kind: model.kind,
        count,
        input: {
          modelKey: model.modelKey,
          prompt: prompt.trim().slice(0, model.maxPromptChars),
          aspectRatio: aspect !== "Auto" ? aspect : undefined,
          duration: model.kind === "video" ? (duration ?? undefined) : undefined,
          quality: tier ?? undefined,
          sound: model.supportsSound ? sound : undefined,
          references: frames ? undefined : media,
          startFrame: frames ? media[0] : undefined,
          endFrame: frames && model.supportsEndFrame ? media[1] : undefined,
        },
      });
      toast.success(t("generationStarted", { count }));
    } catch (err) {
      if (err instanceof JobSubmissionError && err.code === "insufficient_credits") {
        toast.error(t("insufficientCredits"));
      } else if (err instanceof RateLimitedError) {
        toast.error(t("rateLimited", { seconds: err.retryAfterSeconds }));
      } else {
        toast.error(t("submitFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl bg-surface-1 p-3">
      {/* image / video mode toggle */}
      <div className="mb-3 inline-flex items-center gap-1 rounded-xl bg-surface-3 p-1">
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
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-3",
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

      {/* attachments strip */}
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <AttachmentThumb
              key={a.id}
              attachment={a}
              onRemove={() => studio?.removeAttachment(a.id)}
              removeLabel={t("removeAttachment")}
            />
          ))}
        </div>
      )}

      {/* start-frame hint (image-to-video models) */}
      {model?.requiresStartFrame && readyAttachments.length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">{t("startFrameNeeded")}</p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* prompt row */}
          <div className="flex items-start gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple={model?.attachments === "references"}
              className="hidden"
              onChange={(e) => {
                onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label={t("addReference")}
              disabled={!model || attachments.length >= maxImages}
              onClick={() => fileInput.current?.click()}
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:opacity-30"
            >
              <Plus className="size-5" />
            </button>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              maxLength={model?.maxPromptChars}
              placeholder={animate ? animatedPlaceholder : basePlaceholder}
              // Once the user types, direction follows the content (English → LTR,
              // Arabic → RTL) regardless of locale. While empty, the placeholder is
              // in the site language, so follow the locale direction.
              dir={prompt.length > 0 ? "auto" : localeDir}
              rows={1}
              className="mt-1.5 max-h-40 w-full resize-none bg-transparent text-start text-sm text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
            />
          </div>

          {/* controls row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* model */}
            <Dropdown
              panelClassName="min-w-64"
              trigger={({ toggle }) => (
                <Pill onClick={toggle} disabled={modelsLoading && !model}>
                  {model ? (
                    <>
                      <ProviderBadge provider={model.provider} />
                      {model.name}
                    </>
                  ) : (
                    <span className="h-3.5 w-24 animate-pulse rounded bg-surface-2" />
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
                      <ProviderBadge provider={m.provider} />
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

            {/* aspect */}
            <Dropdown
              panelClassName="max-h-80 min-w-44 overflow-y-auto"
              trigger={({ toggle }) => (
                <Pill onClick={toggle}>
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

            {/* quality tier (models that price per tier) */}
            {model?.tiers && model.tiers.length > 0 && (
              <Dropdown
                panelClassName="min-w-52"
                trigger={({ toggle }) => (
                  <Pill onClick={toggle}>
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

            {/* duration (video) */}
            {isVideo && (model?.durations.length ?? 0) > 0 && (
              <Dropdown
                panelClassName="min-w-40"
                trigger={({ toggle }) => (
                  <Pill onClick={toggle}>
                    <Timer weight="bold" className="size-3.5 text-accent-turquoise" />
                    {duration != null ? `${duration}s` : "—"}
                  </Pill>
                )}
              >
                {({ close }) => (
                  <>
                    <MenuLabel>{t("duration")}</MenuLabel>
                    {model!.durations.map((d) => (
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

            {/* native audio (Kling 3 Omni) */}
            {model?.supportsSound && (
              <Pill active={sound} onClick={() => setSound((s) => !s)}>
                {sound ? (
                  <SpeakerHigh weight="fill" className="size-4 text-accent-turquoise" />
                ) : (
                  <SpeakerSlash className="size-4" />
                )}
                {t("sound")}
              </Pill>
            )}

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
          onClick={onGenerate}
          // Outside the studio (marketing hero) the button is a plain CTA;
          // inside, it gates on prompt/attachment/upload readiness.
          disabled={!isLoaded || (!!studio && !!isSignedIn && !canGenerate)}
          className={cn(
            "flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-6 font-semibold outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:opacity-40 sm:h-auto sm:w-auto sm:self-stretch",
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
    </div>
  );
}
