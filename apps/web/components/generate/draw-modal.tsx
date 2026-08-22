"use client";

/**
 * Draw — annotate an image and attach it as a reference.
 *
 * The point is not painting: it is MARKING UP. Arrows, boxes and short
 * labels on top of a photo tell the model "change this bit, not that
 * one" far more precisely than a sentence can. The output is a normal
 * reference image, so no provider work is involved — the annotated
 * pixels are simply what the model sees.
 *
 * Two stages: pick a source (upload, or one of the references already
 * on the prompt bar), then annotate it. Saving hands a PNG `File` to
 * the caller, which drops it into the existing attachment pipeline.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpRight,
  Check,
  Circle,
  Minus,
  PenLine,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DRAW_COLORS,
  DRAW_WIDTHS,
  drawAll,
  drawShape,
  textSizePx,
  type Point,
  type Shape,
  type Tool,
} from "@/components/generate/draw-annotations";

/** Longest edge of the exported PNG. Keeps uploads well under the 25MB cap. */
const MAX_EXPORT_EDGE = 2048;

export type DrawSource = { id: string; url: string; label?: string };

/* ------------------------------------------------------------- helpers */

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Load a URL into an <img> without tainting a canvas.
 *
 * References can be blob: URLs (local uploads) or Worker-served asset
 * URLs on another origin. Rather than rely on `crossOrigin` plus the
 * right CORS header — which fails closed with an opaque SecurityError
 * at `toBlob()` time, long after the user has done the work — fetch the
 * bytes and hand the <img> a same-origin blob: URL. Nothing can taint.
 */
async function loadImage(
  url: string,
): Promise<{ img: HTMLImageElement; objectUrl: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const objectUrl = URL.createObjectURL(await res.blob());
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = objectUrl;
    });
    // The URL is returned, NOT revoked here. The canvas re-draws from
    // this element on every pointer move; revoking the moment it decodes
    // relies on the bitmap outliving its URL, which the spec allows but
    // is not worth betting a redraw loop on. The caller revokes when the
    // image is actually finished with.
    return { img, objectUrl };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

/* --------------------------------------------------------------- chrome */

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg transition-colors",
        active
          ? "bg-surface-1 text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- modal */

export function DrawModal({
  open,
  sources,
  onClose,
  onSave,
}: {
  open: boolean;
  /** Images already attached to the prompt, offered as a starting point. */
  sources: DrawSource[];
  onClose: () => void;
  /** The annotated PNG. The caller attaches it as a new reference. */
  onSave: (file: File) => void;
}) {
  const t = useTranslations("draw");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  /** Blob URL backing `imageRef`, revoked when the image is replaced. */
  const objectUrlRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [hasImage, setHasImage] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [redo, setRedo] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState<string>(DRAW_COLORS[0]);
  const [widthIdx, setWidthIdx] = useState(1);
  const [saving, setSaving] = useState(false);

  /** Displayed size of the image box, in CSS pixels. */
  const [box, setBox] = useState({ w: 0, h: 0 });
  /** The stroke currently under the pointer, not yet committed. */
  const [draft, setDraft] = useState<Shape | null>(null);
  /** Where a text label is being typed, if anywhere. */
  const [textAt, setTextAt] = useState<Point | null>(null);
  const [textValue, setTextValue] = useState("");

  const width = DRAW_WIDTHS[widthIdx]!;

  /* ------------------------------------------------- dialog lifecycle */

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  const releaseImage = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    imageRef.current = null;
  }, []);

  const reset = useCallback(() => {
    releaseImage();
    setHasImage(false);
    setShapes([]);
    setRedo([]);
    setDraft(null);
    setTextAt(null);
    setTextValue("");
    setBox({ w: 0, h: 0 });
  }, [releaseImage]);

  // Start clean on every open — a modal that reopens onto the previous
  // session's arrows looks broken.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  // Unmount: the prompt bar drops this component when the composer flips
  // to video, which would otherwise strand the blob.
  useEffect(() => releaseImage, [releaseImage]);

  /* ------------------------------------------------------ source load */

  const loadSource = useCallback(
    async (url: string) => {
      setLoading(true);
      try {
        const { img, objectUrl } = await loadImage(url);
        releaseImage();
        imageRef.current = img;
        objectUrlRef.current = objectUrl;
        setShapes([]);
        setRedo([]);
        setHasImage(true);
      } catch {
        toast.error(t("loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [releaseImage, t],
  );

  const onPickFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error(t("notAnImage"));
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      void loadSource(objectUrl).finally(() => URL.revokeObjectURL(objectUrl));
    },
    [loadSource, t],
  );

  /* --------------------------------------------------------- sizing */

  // Fit the image inside the stage, preserving aspect. Measured rather
  // than done with `object-contain` because the canvas has to sit
  // exactly on the image, and only a measured box gives both the same
  // rect at every viewport size.
  useLayoutEffect(() => {
    if (!open || !hasImage) return;
    const stage = stageRef.current;
    const img = imageRef.current;
    if (!stage || !img) return;

    const fit = () => {
      const { width: aw, height: ah } = stage.getBoundingClientRect();
      if (aw === 0 || ah === 0) return;
      const scale = Math.min(aw / img.naturalWidth, ah / img.naturalHeight, 1);
      setBox({
        w: Math.max(1, Math.floor(img.naturalWidth * scale)),
        h: Math.max(1, Math.floor(img.naturalHeight * scale)),
      });
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [open, hasImage]);

  /* -------------------------------------------------------- painting */

  // One redraw for the image plus every committed shape plus the draft.
  // Cheap enough at preview resolution to do on every pointermove, and
  // it keeps a single source of truth for what the canvas shows.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || box.w === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(box.w * dpr);
    canvas.height = Math.floor(box.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    ctx.drawImage(img, 0, 0, box.w, box.h);
    drawAll(ctx, shapes, box.w, box.h);
    if (draft) drawShape(ctx, draft, box.w, box.h);
  }, [box, shapes, draft]);

  const commit = useCallback((shape: Shape) => {
    setShapes((prev) => [...prev, shape]);
    setRedo([]);
  }, []);

  // Both stacks are read and written from the event handler, never from
  // inside an updater. React double-invokes updater functions under
  // StrictMode, so `setRedo` called from within `setShapes` pushed every
  // undone shape onto the redo stack twice and the two stacks drifted
  // apart after a single undo/redo round trip.
  const undo = useCallback(() => {
    if (shapes.length === 0) return;
    const last = shapes[shapes.length - 1]!;
    setShapes(shapes.slice(0, -1));
    setRedo([...redo, last]);
  }, [shapes, redo]);

  const redoLast = useCallback(() => {
    if (redo.length === 0) return;
    const last = redo[redo.length - 1]!;
    setRedo(redo.slice(0, -1));
    setShapes([...shapes, last]);
  }, [shapes, redo]);

  /* ------------------------------------------------------- pointers */

  const pointAt = useCallback((e: React.PointerEvent): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Clamped: a drag that leaves the canvas should stop at the edge
    // rather than record a mark outside the exported image.
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (textAt) return; // let the open label commit first
    const p = pointAt(e);
    if (tool === "text") {
      setTextValue("");
      setTextAt(p);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft(
      tool === "pen"
        ? { id: uid(), kind: "pen", points: [p], color, width }
        : { id: uid(), kind: tool, from: p, to: p, color, width },
    );
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return;
    const p = pointAt(e);
    setDraft((d) =>
      !d
        ? d
        : d.kind === "pen"
          ? { ...d, points: [...d.points, p] }
          : { ...d, to: p },
    );
  };

  const endStroke = () => {
    if (!draft) return;
    // Discard taps that produced no mark — otherwise every stray click
    // lands an invisible shape on the undo stack.
    const empty =
      draft.kind === "pen"
        ? draft.points.length < 2
        : draft.kind !== "text" &&
          Math.abs(draft.to.x - draft.from.x) < 0.005 &&
          Math.abs(draft.to.y - draft.from.y) < 0.005;
    if (!empty) commit(draft);
    setDraft(null);
  };

  const commitText = () => {
    const value = textValue.trim();
    if (textAt && value) {
      commit({
        id: uid(),
        kind: "text",
        at: textAt,
        text: value,
        color,
        width,
      });
    }
    setTextAt(null);
    setTextValue("");
  };

  /* -------------------------------------------------------- shortcuts */

  useEffect(() => {
    if (!open || !hasImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (textAt) return; // typing a label
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoLast();
        else undo();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hasImage, textAt, undo, redoLast]);

  /* ------------------------------------------------------------ save */

  const save = async () => {
    const img = imageRef.current;
    if (!img || saving) return;
    setSaving(true);
    try {
      // Export at the source's own resolution (capped), NOT the preview
      // size — the model should get the sharpest version we have.
      const scale = Math.min(
        1,
        MAX_EXPORT_EDGE / Math.max(img.naturalWidth, img.naturalHeight),
      );
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);

      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0, w, h);
      drawAll(ctx, shapes, w, h);

      // PNG, not JPEG: annotation is high-contrast line work, and JPEG
      // rings around every arrow — exactly the detail the model needs.
      const blob = await new Promise<Blob | null>((r) =>
        out.toBlob(r, "image/png"),
      );
      if (!blob) throw new Error("encode failed");

      onSave(
        new File([blob], `annotated-${Date.now()}.png`, { type: "image/png" }),
      );
      onClose();
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------------------------------------- render */

  const tools: { id: Tool; label: string; icon: React.ReactNode }[] = [
    {
      id: "arrow",
      label: t("toolArrow"),
      icon: <ArrowUpRight className="size-4" />,
    },
    { id: "pen", label: t("toolPen"), icon: <PenLine className="size-4" /> },
    { id: "line", label: t("toolLine"), icon: <Minus className="size-4" /> },
    { id: "rect", label: t("toolRect"), icon: <Square className="size-4" /> },
    {
      id: "ellipse",
      label: t("toolEllipse"),
      icon: <Circle className="size-4" />,
    },
    { id: "text", label: t("toolText"), icon: <Type className="size-4" /> },
  ];

  return (
    <dialog
      ref={dialogRef}
      aria-label={t("title")}
      onCancel={(e) => {
        e.preventDefault();
        // Escape backs out of the label being typed before it closes
        // the whole editor — losing the drawing to a stray key is rude.
        if (textAt) {
          setTextAt(null);
          setTextValue("");
          return;
        }
        onClose();
      }}
      // No `flex` (or any display utility) on the dialog itself: it would
      // beat the UA's `dialog:not([open]) { display: none }` and leave a
      // collapsed, non-modal husk of this component sitting in the page
      // whenever it is closed. The flexbox lives on the wrapper below.
      className="m-auto h-[92dvh] w-[min(1100px,94vw)] overflow-hidden rounded-2xl border border-border bg-surface-1 p-0 text-foreground shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("title")}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            onPickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {!hasImage ? (
          /* ---------------------------------------------- source picker */
          <div className="flex-1 overflow-y-auto p-6">
            <button
              type="button"
              disabled={loading}
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-2 py-10 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-60"
            >
              <Upload className="size-6" />
              <span className="font-medium">{t("uploadCta")}</span>
              <span className="text-xs">{t("uploadHint")}</span>
            </button>

            {sources.length > 0 && (
              <section className="mt-6">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("fromReferences")}
                </p>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {sources.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={loading}
                      onClick={() => void loadSource(s.url)}
                      className="group relative aspect-square overflow-hidden rounded-lg bg-surface-2 outline-none ring-primary transition focus-visible:ring-2 disabled:opacity-60"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.url}
                        alt=""
                        className="size-full object-cover transition-transform group-hover:scale-105"
                      />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {sources.length === 0 && (
              <p className="mt-6 text-center text-xs text-muted-foreground">
                {t("noReferences")}
              </p>
            )}
          </div>
        ) : (
          /* --------------------------------------------------- editor */
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <div className="flex items-center gap-0.5 rounded-lg bg-surface-3 p-0.5">
                {tools.map((x) => (
                  <ToolButton
                    key={x.id}
                    active={tool === x.id}
                    label={x.label}
                    onClick={() => setTool(x.id)}
                  >
                    {x.icon}
                  </ToolButton>
                ))}
              </div>

              <div className="flex items-center gap-1.5 rounded-lg bg-surface-3 px-2 py-1.5">
                {DRAW_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    aria-pressed={color === c}
                    onClick={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    className={cn(
                      "size-5 rounded-full ring-offset-2 ring-offset-surface-3 transition",
                      color === c
                        ? "ring-2 ring-foreground"
                        : "ring-1 ring-white/20",
                    )}
                  />
                ))}
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-surface-3 p-1">
                {DRAW_WIDTHS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={t("strokeWidth", { step: i + 1 })}
                    aria-pressed={widthIdx === i}
                    onClick={() => setWidthIdx(i)}
                    className={cn(
                      "grid size-7 place-items-center rounded-md transition-colors",
                      widthIdx === i ? "bg-surface-1" : "hover:bg-white/5",
                    )}
                  >
                    <span
                      className="rounded-full bg-foreground"
                      style={{ width: 4 + i * 4, height: 4 + i * 4 }}
                    />
                  </button>
                ))}
              </div>

              <div className="ms-auto flex items-center gap-0.5 rounded-lg bg-surface-3 p-0.5">
                <ToolButton label={t("undo")} onClick={undo}>
                  <Undo2
                    className={cn(
                      "size-4",
                      shapes.length === 0 && "opacity-30",
                    )}
                  />
                </ToolButton>
                <ToolButton label={t("redo")} onClick={redoLast}>
                  <Redo2
                    className={cn("size-4", redo.length === 0 && "opacity-30")}
                  />
                </ToolButton>
                <ToolButton
                  label={t("clear")}
                  onClick={() => {
                    setShapes([]);
                    setRedo([]);
                  }}
                >
                  <Trash2
                    className={cn(
                      "size-4",
                      shapes.length === 0 && "opacity-30",
                    )}
                  />
                </ToolButton>
              </div>
            </div>

            <div
              ref={stageRef}
              className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/40 p-4"
            >
              <div className="relative" style={{ width: box.w, height: box.h }}>
                <canvas
                  ref={canvasRef}
                  style={{ width: box.w, height: box.h }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endStroke}
                  onPointerCancel={endStroke}
                  // Without this a drag on a touch screen scrolls the page
                  // instead of drawing.
                  className="touch-none rounded-lg shadow-lg"
                />
                {textAt && (
                  <input
                    autoFocus
                    value={textValue}
                    onChange={(e) => setTextValue(e.target.value)}
                    onBlur={commitText}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitText();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setTextAt(null);
                        setTextValue("");
                      }
                    }}
                    placeholder={t("textPlaceholder")}
                    style={{
                      left: `${textAt.x * 100}%`,
                      top: `${textAt.y * 100}%`,
                      fontSize: textSizePx(width, box.w, box.h),
                      color,
                    }}
                    className="absolute min-w-24 max-w-[60%] rounded border border-white/40 bg-black/70 px-1 font-semibold leading-tight outline-none"
                  />
                )}
              </div>
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border p-3">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-surface-3 px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                {t("changeImage")}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  <Check className="size-4" />
                  {t("addAsReference")}
                </button>
              </div>
            </footer>
          </>
        )}

        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <span className="size-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        )}
      </div>
    </dialog>
  );
}
