"use client";

/**
 * Video Upscaler — take a clip and make it bigger.
 *
 * TWO WAYS IN, ONE MODAL. Opened empty it shows an upload box; opened
 * with a clip from the project grid it skips straight to the options.
 * Same component either way, the way Camera Angle already handles a
 * tile-supplied photo.
 *
 * THE PRICE MOVES ON FOUR THINGS, which is why the options only appear
 * after the file does:
 *
 *   length      fal bills per second of the SOURCE clip
 *   resolution  2K is twice 1080p; 4K is four times it
 *   frame rate  60fps doubles whatever the resolution costs
 *   tier        Pro is TEN TIMES Standard
 *
 * Every one of those is read from the model's own `priceTable` — the
 * same `tier_pricing` map the server charges from, under the same
 * composed key (`4k_60_pro`) — so the number on the button cannot drift
 * from the number in the ledger. The browser reads the clip's duration
 * from its metadata for display; the server probes it again for the
 * charge, because a number the client supplies is a number the client
 * can change.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowsOutSimple, CaretDown, FilmStrip, Sparkle } from "@phosphor-icons/react";

import { ToolModal } from "@/components/tools/tool-modal";
import { useStudioMaybe } from "@/components/studio/studio-context";
import { useModels } from "@/lib/use-models";
import { getSDK } from "@/lib/api";
import { JobSubmissionError, RateLimitedError } from "@clickfy/sdk";
import type { GenModel } from "@clickfy/sdk";
import { bitDepthAllowed, upscalePriceKey } from "@clickfy/types";
import type {
  UpscaleBitDepth,
  UpscaleFidelity,
  UpscaleFps,
  UpscalePreset,
  UpscaleTier,
} from "@clickfy/types";
import { cn } from "@/lib/utils";

/** A clip handed to the tool from an existing tile. */
export type ToolVideo = { id: string; src: string };

// What the API's upload gate accepts — and nothing it does not. WebM was
// listed here once; the dialog let it through and the API refused it.
const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v"];
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

/** One row of chips: a label, the options, and what is selected. */
function ChipRow<T extends string | number>({
  label,
  hint,
  options,
  value,
  onChange,
  labelFor,
  disabledFor,
}: {
  label: string;
  hint?: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  labelFor?: (option: T) => string;
  disabledFor?: (option: T) => boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const disabled = disabledFor?.(option) ?? false;
          return (
            <button
              key={String(option)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option)}
              className={cn(
                "rounded-lg border px-3.5 py-1.5 text-sm transition-colors",
                value === option
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed opacity-35 hover:text-muted-foreground",
              )}
            >
              {labelFor ? labelFor(option) : String(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function UpscaleModal({
  initialVideo,
  onClose,
}: {
  initialVideo: ToolVideo | null;
  onClose: () => void;
}) {
  const t = useTranslations("tools");
  const studio = useStudioMaybe();
  // `allModels`, not `models`: these are deliberately absent from the
  // composer's picker, and their prices still have to come from the
  // roster.
  const { allModels } = useModels("video");
  /**
   * Every upscaler we carry, not one hard-coded key. There is one today;
   * a second becomes a catalogue entry and appears here with no change
   * to this file — which is the whole reason the picker exists at one
   * option rather than being hidden until there are two.
   */
  const upscalers = useMemo(
    () => allModels.filter((m) => m.toolOnly && m.kind === "video" && m.upscaleOptions),
    [allModels],
  );
  const [modelKey, setModelKey] = useState<string | null>(null);
  const model: GenModel | undefined =
    upscalers.find((m) => m.modelKey === modelKey) ?? upscalers[0];
  const options = model?.upscaleOptions;

  const [source, setSource] = useState<Source | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Settings. Seeded from the model's own declared defaults, and reset
  // whenever the model changes — a preset from one upscaler means
  // nothing to the next one.
  const [resolution, setResolution] = useState<string>("1080p");
  const [tier, setTier] = useState<UpscaleTier>("standard");
  const [fps, setFps] = useState<UpscaleFps>(30);
  const [preset, setPreset] = useState<UpscalePreset>("aigc");
  const [fidelity, setFidelity] = useState<UpscaleFidelity>("high");
  const [bitDepth, setBitDepth] = useState<UpscaleBitDepth>(8);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!options) return;
    setResolution(options.defaults.resolution);
    setTier(options.defaults.tier as UpscaleTier);
    setFps(options.defaults.fps as UpscaleFps);
    setPreset(options.defaults.preset as UpscalePreset);
    setFidelity(options.defaults.fidelity as UpscaleFidelity);
    setBitDepth(options.defaults.bitDepth as UpscaleBitDepth);
  }, [model?.modelKey, options]);

  // A bit depth the tier cannot serve would be dropped by the server.
  // Move it back here instead, so the control never shows a choice that
  // will not happen.
  useEffect(() => {
    if (!bitDepthAllowed(bitDepth, tier)) setBitDepth(8);
  }, [tier, bitDepth]);

  const resolutions = model?.tiers?.map((x) => x.mode) ?? ["1080p"];

  /**
   * The price, from the catalogue rather than from a constant here.
   *
   * `priceTable[key]` is quoted at the model's reference length and the
   * server scales it by the real duration — `ceil(base x seconds / ref)`,
   * exactly what `resolveCreditCost` does — so the estimate below has to
   * scale the same way or the button would promise one number and the
   * charge would be another.
   */
  const referenceSeconds = model?.defaultDuration ?? 5;
  const perReference =
    model?.priceTable?.[upscalePriceKey(resolution, fps, tier)] ?? model?.costCredits ?? null;
  const price =
    perReference != null && source?.seconds
      ? Math.max(1, Math.ceil((perReference * source.seconds) / referenceSeconds))
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

  const canGenerate =
    source?.status === "ready" && !!source.media && !submitting && !!studio && !!model;

  const onGenerate = async () => {
    if (!canGenerate || !source?.media || !model) return;
    setSubmitting(true);
    try {
      await studio!.startGeneration({
        kind: "video",
        count: 1,
        input: {
          modelKey: model.modelKey,
          // The model reads no prompt; the server exempts models whose
          // `maxPromptChars` is 0 from the "say something" rule.
          prompt: "",
          // Resolution rides the ordinary tier channel; the rest is the
          // model's own option block. Both are priced server-side from
          // the same composed key this modal quoted from.
          quality: resolution,
          upscale: { preset, tier, fps, fidelity, bitDepth },
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

  const selectClass =
    "w-full appearance-none rounded-xl border border-border bg-surface-1 px-3 py-2.5 pe-9 text-sm text-foreground outline-none transition-colors focus:border-primary/60";

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
          <div className="space-y-5">
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

            {/* Which upscaler. One entry today; the control exists so a
                second one is a catalogue row rather than a redesign. */}
            <div>
              <p className="text-sm font-medium">{t("model")}</p>
              <div className="relative mt-2">
                <select
                  value={model?.modelKey ?? ""}
                  onChange={(e) => setModelKey(e.target.value)}
                  className={selectClass}
                >
                  {upscalers.map((m) => (
                    <option key={m.modelKey} value={m.modelKey}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <CaretDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            {options && (
              <>
                <ChipRow
                  label={t("upscaleTo")}
                  options={resolutions}
                  value={resolution}
                  onChange={setResolution}
                  labelFor={(r) => r.toUpperCase()}
                />

                <ChipRow
                  label={t("frameRate")}
                  options={options.fps as UpscaleFps[]}
                  value={fps}
                  onChange={setFps}
                  labelFor={(f) => t("fpsValue", { fps: f })}
                />

                {/* The expensive one. Pro is ten times Standard upstream,
                    so the price difference on the button is real and the
                    hint says why before it is pressed. */}
                <ChipRow
                  label={t("enhancement")}
                  hint={t("enhancementHint")}
                  options={options.tiers as UpscaleTier[]}
                  value={tier}
                  onChange={setTier}
                  labelFor={(x) => t(`tier_${x}`)}
                />

                <div>
                  <p className="text-sm font-medium">{t("scene")}</p>
                  <div className="relative mt-2">
                    <select
                      value={preset}
                      onChange={(e) => setPreset(e.target.value as UpscalePreset)}
                      className={selectClass}
                    >
                      {options.presets.map((p) => (
                        <option key={p} value={p}>
                          {t(`preset_${p}`)}
                        </option>
                      ))}
                    </select>
                    <CaretDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                  {/* What the chosen preset is FOR. A native select can
                      only show one line per option, so the explanation
                      follows the selection instead of sitting inside the
                      list — five scene names mean nothing on their own. */}
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t(`preset_${preset}_desc`)}
                  </p>
                </div>

                {/* Detail and colour depth change the output but not the
                    price, so they sit behind a disclosure rather than
                    competing with the three controls that do. */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <CaretDown
                      className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")}
                    />
                    {t("advanced")}
                  </button>
                  {showAdvanced && (
                    <div className="mt-3 space-y-4">
                      <ChipRow
                        label={t("detail")}
                        hint={t(`fidelity_${fidelity}_desc`)}
                        options={options.fidelities as UpscaleFidelity[]}
                        value={fidelity}
                        onChange={setFidelity}
                        labelFor={(f) => t(`fidelity_${f}`)}
                      />
                      <ChipRow
                        label={t("colorDepth")}
                        hint={tier === "pro" ? undefined : t("colorDepthProOnly")}
                        options={options.bitDepths as UpscaleBitDepth[]}
                        value={bitDepth}
                        onChange={setBitDepth}
                        labelFor={(d) => t("bitValue", { bits: d })}
                        disabledFor={(d) => !bitDepthAllowed(d, tier)}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

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
          {tier === "pro" ? t("upscaleNotePro") : t("upscaleNote")}
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
