"use client";

/**
 * Camera Angle — re-shoot a photo from a new camera position.
 *
 * Two ways to say where the camera goes, one switch between them:
 * - Camera: park the camera on the orbit stage (free degrees).
 * - Presets: pick a named shot — wide, medium, close-up, low angle.
 *
 * Either way the user's entire input is the photo plus that choice; the
 * prompt is engineered server-side (`camera_angle` / `camera_preset` in
 * providers/tool-prompts.ts) and never shown. Generating goes through
 * the studio's normal create path, so the result arrives as a pending
 * tile in the project grid like any generation.
 *
 * Orbit math: the puck rides an ellipse (the ring seen in perspective).
 * H is the azimuth — 0° is the original camera position at the front
 * of the ring; dragging horizontally orbits. V is elevation (−80…80),
 * driven by vertical drag; it nudges the puck off the ring and is
 * reported exactly in the readout. Behind the subject (|H| > 90°) the
 * puck dims — the model will be inventing what the photo never saw,
 * which is allowed but worth signalling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowCounterClockwise,
  Check,
  Globe,
  Sparkle,
  SquaresFour,
  UploadSimple,
  VideoCamera,
} from "@phosphor-icons/react";
import { JobSubmissionError, RateLimitedError, type CreateToolInput } from "@clickfy/sdk";
import { getSDK } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useModels } from "@/lib/use-models";
import { useStudioMaybe } from "@/components/studio/studio-context";
import { ToolModal } from "@/components/tools/tool-modal";
import type { ToolPhoto } from "@/components/tools/tools-context";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_MB = 25;

/** Radius of the orbit sphere's wireframe, in px. */
const SPHERE_R = 150;

type Mode = "camera" | "presets";

const MODES: ReadonlyArray<{ value: Mode; labelKey: string; Icon: typeof Globe }> = [
  { value: "camera", labelKey: "modeCamera", Icon: Globe },
  { value: "presets", labelKey: "modePresets", Icon: SquaresFour },
];

type Preset = Extract<CreateToolInput, { kind: "camera_preset" }>["preset"];

/**
 * Mirrors CAMERA_PRESETS in providers/tool-prompts.ts. Each shot shows
 * one example frame (public/tools/camera, all of the same scene) so the
 * difference between them reads at a glance.
 */
const PRESETS: ReadonlyArray<{ value: Preset; labelKey: string; image: string }> = [
  { value: "wide", labelKey: "presetWide", image: "/tools/camera/wide.webp" },
  { value: "medium", labelKey: "presetMedium", image: "/tools/camera/medium.webp" },
  { value: "close_up", labelKey: "presetCloseUp", image: "/tools/camera/close-up.webp" },
  { value: "low_angle", labelKey: "presetLowAngle", image: "/tools/camera/low-angle.webp" },
];

type Photo = {
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  media?: { r2Key: string; mimeType: string; sizeBytes: number };
  /** Natural dimensions, for picking the closest supported ratio. */
  width?: number;
  height?: number;
};

/** The supported ratio closest in shape to the uploaded photo. */
function nearestAspect(ratios: string[], width?: number, height?: number): string | undefined {
  if (!width || !height || ratios.length === 0) return undefined;
  const target = Math.log(width / height);
  let best: string | undefined;
  let bestDist = Infinity;
  for (const r of ratios) {
    const [w, h] = r.split(":").map(Number);
    if (!w || !h) continue;
    const dist = Math.abs(Math.log(w / h) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return best;
}

export function CameraAngleModal({
  initialPhoto,
  onClose,
}: {
  initialPhoto: ToolPhoto | null;
  onClose: () => void;
}) {
  const t = useTranslations("tools");
  const studio = useStudioMaybe();
  const { models } = useModels("image");
  // The tool's model is a server decision; the roster is read only to
  // show the price the server will charge. Mirrors TOOL_MODELS.camera_angle
  // and .camera_preset in providers/tool-prompts.ts (GPT Image 2 at `high`).
  const cameraModel = models.find((m) => m.modelKey === "gpt-image-2");
  const price = cameraModel?.tiers?.find((x) => x.mode === "high")?.costCredits;

  const [mode, setMode] = useState<Mode>("camera");
  const [preset, setPreset] = useState<Preset | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [h, setH] = useState(0);
  const [v, setV] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const setFromBlob = useCallback((blob: Blob, name: string) => {
    if (blob.size > MAX_MB * 1024 * 1024) {
      toast.error(t("photoTooLarge", { max: MAX_MB }));
      return;
    }
    const previewUrl = URL.createObjectURL(blob);
    setPhoto({ previewUrl, status: "uploading" });
    const img = new Image();
    img.onload = () =>
      setPhoto((prev) =>
        prev?.previewUrl === previewUrl
          ? { ...prev, width: img.naturalWidth, height: img.naturalHeight }
          : prev,
      );
    img.src = previewUrl;
    getSDK()
      .uploads.uploadUserAsset({
        file: blob,
        name,
        type: blob.type || "image/jpeg",
        sizeBytes: blob.size,
      })
      .then((ref) =>
        setPhoto((prev) =>
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
        setPhoto((prev) =>
          prev?.previewUrl === previewUrl ? { ...prev, status: "error" } : prev,
        );
        const message = err instanceof Error ? err.message : "";
        toast.error(message && message.length <= 120 ? message : t("uploadFailed"));
      });
  }, [t]);

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error(t("unsupportedPhoto"));
      return;
    }
    setFromBlob(file, file.name);
  };

  // A tile-provided photo is a served URL — pull the bytes and upload
  // them like any reference so the job gets a real r2Key.
  const loadedInitial = useRef(false);
  useEffect(() => {
    if (!initialPhoto || loadedInitial.current) return;
    loadedInitial.current = true;
    fetch(initialPhoto.src)
      .then((res) => {
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        return res.blob();
      })
      .then((blob) => setFromBlob(blob, initialPhoto.src.split("/").pop() ?? "photo.jpg"))
      .catch(() => toast.error(t("uploadFailed")));
  }, [initialPhoto, setFromBlob, t]);

  // ── Orbit drag ───────────────────────────────────────────────────
  // Orbit-view semantics, like any 3D tool: the camera is YOUR eye,
  // fixed at the front with its focal point locked on the photo; the
  // meshed sphere (and the photo inside it) rotates under the drag.
  // Dragging right moves the camera right around the subject, which on
  // screen is the world turning left — hence the sign flips below.
  const dragging = useRef<{ x: number; y: number; h: number; v: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragging.current = { x: e.clientX, y: e.clientY, h, v };
    setIsDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d) return;
    let nextH = d.h + (e.clientX - d.x) * 0.5;
    // Wrap into (-180, 180] so the readout never shows 540°.
    nextH = ((((nextH + 180) % 360) + 360) % 360) - 180;
    setH(Math.round(nextH));
    setV(Math.round(Math.min(80, Math.max(-80, d.v - (e.clientY - d.y) * 0.4))));
  };
  const onPointerUp = () => {
    dragging.current = null;
    setIsDragging(false);
  };

  const behind = Math.cos((h * Math.PI) / 180) < 0;

  const moved = h !== 0 || v !== 0;
  // Each mode keeps its own choice, so flipping between them to compare
  // never throws away where the camera was parked or which shot was picked.
  const tool: CreateToolInput | null =
    mode === "camera"
      ? moved
        ? { kind: "camera_angle", h, v }
        : null
      : preset
        ? { kind: "camera_preset", preset }
        : null;
  const canGenerate = !!photo && photo.status === "ready" && !!tool && !submitting && !!studio;

  const aspectRatio = useMemo(
    () => nearestAspect(cameraModel?.aspectRatios ?? [], photo?.width, photo?.height),
    [cameraModel, photo?.width, photo?.height],
  );

  const onGenerate = async () => {
    if (!canGenerate || !photo?.media || !tool) return;
    setSubmitting(true);
    try {
      await studio!.startGeneration({
        kind: "image",
        count: 1,
        input: {
          prompt: "",
          tool,
          aspectRatio,
          references: [{ kind: "image", ...photo.media }],
        },
      });
      toast.success(t("cameraStarted"));
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

  const uploadButton = (className: string) => (
    <button
      type="button"
      onClick={() => fileInput.current?.click()}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-center text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground",
        className,
      )}
    >
      <UploadSimple className="size-6" />
      <span className="text-sm font-medium">{t("uploadPhoto")}</span>
      <span className="text-xs">{t("uploadPhotoHint")}</span>
    </button>
  );

  return (
    <ToolModal
      title={t("cameraAngle")}
      onClose={onClose}
      panelClassName="max-w-2xl"
      icon={
        <span className="grid size-7 place-items-center rounded-lg bg-accent-turquoise/15">
          <VideoCamera weight="fill" className="size-4 text-accent-turquoise" />
        </span>
      }
    >
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

      {/* The body scrolls on its own so the footer (and Generate) stays
          reachable on short viewports — a phone in landscape is shorter
          than the orbit stage alone. */}
      <div className="nice-scroll min-h-0 flex-1 overflow-y-auto">
        {/* toolbar — mode switch + replace photo */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 sm:px-5">
          <div
            role="group"
            aria-label={t("modeLabel")}
            className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5"
          >
            {MODES.map(({ value, labelKey, Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/60",
                  mode === value
                    ? "bg-surface-3 text-foreground shadow-sm shadow-black/40"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon weight={mode === value ? "fill" : "regular"} className="size-3.5" />
                {t(labelKey)}
              </button>
            ))}
          </div>

          {photo && (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label={t("replacePhoto")}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-3/85 px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground sm:px-3"
            >
              <UploadSimple className="size-3.5" />
              <span className="hidden min-[420px]:inline">{t("replacePhoto")}</span>
            </button>
          )}
        </div>

        {mode === "camera" ? (
          /* orbit stage.
             Pinned to LTR on purpose: this is a 3D viewport, not text. Under
             the page's RTL direction, absolutely positioned children with no
             `left` take their static position from the RIGHT edge of the
             containing block, so every ring and the photo (which are centred
             with translate(-50%)) slid a full diameter off to the side and
             the stage looked broken. The camera orbit, the axes and the drag
             direction are physical and must read the same in every locale. */
          <div
            dir="ltr"
            className={cn(
              "relative h-[400px] touch-none select-none overflow-hidden bg-surface-1",
              photo && "cursor-grab active:cursor-grabbing",
            )}
            onPointerDown={photo ? onPointerDown : undefined}
            onPointerMove={photo ? onPointerMove : undefined}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_44%,var(--surface-2)_0%,var(--surface-1)_70%)]" />

            {photo ? (
              <>
                {/* 3D orbit stage — a wireframe sphere in true perspective.
                    Everything inside `world` shares one preserve-3d space
                    and rotates together with the drag: rotateX(v) tips the
                    world so a positive V looks down from above, and
                    rotateY(-h) turns it so a positive H views from the
                    right — real orbit-view math, not a flat illustration. */}
                <div
                  className="absolute inset-0"
                  style={{ perspective: "900px", perspectiveOrigin: "50% 42%" }}
                >
                  <div
                    className="absolute left-1/2 top-[52%]"
                    style={{
                      transformStyle: "preserve-3d",
                      transform: `rotateX(${v}deg) rotateY(${-h}deg)`,
                      transition: isDragging ? "none" : "transform 160ms ease-out",
                    }}
                  >
                    {/* longitude rings — the vertical cage of the mesh */}
                    {[0, 30, 60, 90, 120, 150].map((deg) => (
                      <div
                        key={`lon-${deg}`}
                        className={cn(
                          "absolute left-0 top-0 rounded-full border",
                          deg === 0
                            ? "border-accent-turquoise/40"
                            : "border-dashed border-accent-turquoise/15",
                        )}
                        style={{
                          width: SPHERE_R * 2,
                          height: SPHERE_R * 2,
                          transform: `translate(-50%, -50%) rotateY(${deg}deg)`,
                        }}
                      />
                    ))}
                    {/* latitude rings — equator emphasized, ±40° faint */}
                    {[
                      { lat: 0, cls: "border-accent-turquoise/50" },
                      { lat: 40, cls: "border-dashed border-accent-turquoise/15" },
                      { lat: -40, cls: "border-dashed border-accent-turquoise/15" },
                    ].map(({ lat, cls }) => {
                      const r = SPHERE_R * Math.cos((lat * Math.PI) / 180);
                      const y = -SPHERE_R * Math.sin((lat * Math.PI) / 180);
                      return (
                        <div
                          key={`lat-${lat}`}
                          className={cn("absolute left-0 top-0 rounded-full border", cls)}
                          style={{
                            width: r * 2,
                            height: r * 2,
                            transform: `translate(-50%, -50%) translateY(${y}px) rotateX(90deg)`,
                          }}
                        />
                      );
                    })}

                    {/* the photo, on the plane at the sphere's center — it
                        rotates with the world, so what you see IS the shot
                        from the camera's new position */}
                    <div
                      className="absolute left-0 top-0"
                      style={{ transform: "translate(-50%, -50%)" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.previewUrl}
                        alt=""
                        draggable={false}
                        className={cn(
                          "max-h-44 max-w-40 rounded-[10px] border border-border object-contain shadow-2xl shadow-black/60 transition-opacity",
                          photo.status !== "ready" && "opacity-50",
                        )}
                      />
                    </div>
                  </div>
                </div>

                {/* the camera — fixed at the front, focal point locked on
                    the center; the world turns, the camera never leaves
                    your eye */}
                <div className="pointer-events-none absolute bottom-9 left-1/2 flex -translate-x-1/2 flex-col items-center">
                  <div className="h-6 w-px border-s border-dashed border-accent-turquoise/50" />
                  <div className="grid size-10 place-items-center rounded-full bg-accent-turquoise shadow-[0_8px_24px_rgba(0,220,174,0.4),0_0_0_5px_rgba(0,220,174,0.14)]">
                    <VideoCamera weight="fill" className="size-5 text-black" />
                  </div>
                </div>

                {/* readout */}
                <div className="absolute end-4 top-3.5 flex h-8 items-center gap-2 rounded-lg border border-border bg-surface-3/85 px-3 text-xs tabular-nums">
                  <span className="size-1.5 rounded-full bg-accent-turquoise" />
                  <span>H {h}°</span>
                  <span className="text-border">·</span>
                  <span>V {v}°</span>
                </div>

                <p className="pointer-events-none absolute inset-x-0 bottom-3.5 px-4 text-center text-xs text-muted-foreground">
                  {behind ? t("behindHint") : t("dragHint")}
                </p>
              </>
            ) : (
              /* empty state — upload the photo to re-shoot */
              uploadButton(
                "absolute left-1/2 top-1/2 w-[min(20rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 px-6 py-8",
              )
            )}
          </div>
        ) : (
          /* presets — the photo beside a grid of named shots. Stacks on
             phones (photo strip on top, two tiles per row below); side by
             side from `sm`, holding the orbit stage's height so switching
             modes doesn't make the dialog jump. */
          <div className="flex flex-col gap-4 p-4 sm:min-h-[400px] sm:flex-row sm:gap-5 sm:p-5">
            <div className="flex shrink-0 flex-col gap-2 sm:w-44">
              <span className="text-xs text-muted-foreground">{t("yourPhoto")}</span>
              {photo ? (
                <div className="relative h-36 overflow-hidden rounded-xl border border-border bg-surface-2 sm:h-auto sm:flex-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.previewUrl}
                    alt=""
                    draggable={false}
                    className={cn(
                      "absolute inset-0 size-full object-contain p-2 transition-opacity",
                      photo.status !== "ready" && "opacity-50",
                    )}
                  />
                </div>
              ) : (
                uploadButton("h-36 px-4 sm:h-auto sm:flex-1")
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="text-xs text-muted-foreground">{t("presetsLabel")}</span>
              <div className="grid grid-cols-2 gap-3">
                {PRESETS.map(({ value, labelKey, image }) => {
                  const selected = preset === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setPreset(value)}
                      className="group flex min-w-0 flex-col gap-1.5 text-start outline-none"
                    >
                      <span
                        className={cn(
                          "relative block aspect-video overflow-hidden rounded-lg border transition-shadow",
                          selected
                            ? "border-transparent ring-2 ring-primary"
                            : "border-border group-hover:ring-1 group-hover:ring-white/20 group-focus-visible:ring-2 group-focus-visible:ring-primary/60",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image}
                          alt=""
                          draggable={false}
                          loading="lazy"
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                        {selected && (
                          <span className="absolute end-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow shadow-black/40">
                            <Check weight="bold" className="size-3" />
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "truncate text-xs",
                          selected ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {t(labelKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* footer */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5 sm:py-3.5">
        {mode === "camera" ? (
          <button
            type="button"
            onClick={() => {
              setH(0);
              setV(0);
            }}
            disabled={!moved}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-surface-3 px-3 text-sm text-foreground transition-colors hover:bg-surface-2 disabled:opacity-30"
          >
            <ArrowCounterClockwise className="size-3.5" />
            {t("reset")}
          </button>
        ) : (
          <span aria-hidden />
        )}
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden truncate text-xs text-muted-foreground sm:block">
            {mode === "camera" ? t("cameraNote") : t("presetNote")}
          </span>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 sm:px-6"
          >
            {submitting ? t("generating") : t("generate")}
            <Sparkle weight="fill" className="size-4" />
            {price != null && <span className="tabular-nums">{price}</span>}
          </button>
        </div>
      </div>
    </ToolModal>
  );
}
