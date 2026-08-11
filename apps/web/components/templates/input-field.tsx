"use client";

/**
 * Dynamic template-input renderer — the web port of mobile's
 * `components/use-template/InputField`. Media fields upload to R2
 * immediately on pick (presigned PUT with progress) and hand back the
 * `JobInputValue` the submission needs.
 *
 * Web v1 renders: text, textarea, select, image, video.
 * image_multi / toggle / color show a "not supported yet" stub (same
 * graceful-degradation approach mobile used pre-v1).
 */

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { UploadSimple, Warning, X, CheckCircle } from "@phosphor-icons/react";
import type { TemplateInput } from "@clickfy/types";
import type { JobInputValue } from "@clickfy/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getSDK } from "@/lib/api";
import { cn } from "@/lib/utils";

export type FieldState =
  | { status: "empty" }
  | { status: "uploading"; progress: number; previewUrl: string }
  | { status: "ready"; value: JobInputValue; previewUrl?: string }
  | { status: "error" };

export function InputField({
  field,
  state,
  onChange,
}: {
  field: TemplateInput;
  state: FieldState;
  onChange: (next: FieldState) => void;
}) {
  const t = useTranslations("templates");
  const fileInput = useRef<HTMLInputElement>(null);
  const [textValue, setTextValue] = useState(
    state.status === "ready" && state.value.kind === "text" ? state.value.value : "",
  );

  const setText = (v: string) => {
    setTextValue(v);
    onChange(v.trim() ? { status: "ready", value: { kind: "text", value: v } } : { status: "empty" });
  };

  const pickMedia = (file: File | undefined, kind: "image" | "video") => {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    onChange({ status: "uploading", progress: 0, previewUrl });
    getSDK()
      .uploads.uploadUserAsset(
        { file, name: file.name, type: file.type || "application/octet-stream", sizeBytes: file.size },
        { onProgress: (p) => onChange({ status: "uploading", progress: p, previewUrl }) },
      )
      .then((ref) =>
        onChange({
          status: "ready",
          previewUrl,
          value: { kind, r2Key: ref.key, mimeType: ref.contentType, sizeBytes: ref.sizeBytes },
        }),
      )
      .catch(() => onChange({ status: "error" }));
  };

  const label = (
    <div className="mb-1.5 flex items-baseline gap-2">
      <span className="text-sm font-medium">{field.label}</span>
      {!field.required && (
        <span className="text-xs text-muted-foreground">{t("optional")}</span>
      )}
    </div>
  );
  const helper = field.helperText && (
    <p className="mt-1 text-xs text-muted-foreground">{field.helperText}</p>
  );

  switch (field.type) {
    case "text":
      return (
        <div>
          {label}
          <Input
            value={textValue}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            onChange={(e) => setText(e.target.value)}
          />
          {helper}
        </div>
      );

    case "textarea":
      return (
        <div>
          {label}
          <Textarea
            value={textValue}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            rows={field.minLines ?? 3}
            onChange={(e) => setText(e.target.value)}
          />
          {helper}
        </div>
      );

    case "select":
      return (
        <div>
          {label}
          <div className="flex flex-wrap gap-2">
            {field.options.map((o) => {
              const selected =
                state.status === "ready" &&
                state.value.kind === "text" &&
                state.value.value === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() =>
                    onChange({ status: "ready", value: { kind: "text", value: o.value } })
                  }
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                    selected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {helper}
        </div>
      );

    case "image":
    case "video": {
      const accept =
        field.type === "image"
          ? (field.acceptedFormats?.join(",") ?? "image/jpeg,image/png,image/webp")
          : "video/mp4,video/quicktime,video/webm";
      return (
        <div>
          {label}
          <input
            ref={fileInput}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              pickMedia(e.target.files?.[0], field.type);
              e.target.value = "";
            }}
          />
          {state.status === "empty" || state.status === "error" ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className={cn(
                "flex h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm transition-colors",
                state.status === "error"
                  ? "border-status-red/60 text-status-red"
                  : "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground",
              )}
            >
              {state.status === "error" ? (
                <>
                  <Warning weight="fill" className="size-5" />
                  {t("uploadFailedRetry")}
                </>
              ) : (
                <>
                  <UploadSimple className="size-5" />
                  {field.type === "image" ? t("uploadImage") : t("uploadVideo")}
                </>
              )}
            </button>
          ) : (
            <div className="relative h-28 w-full overflow-hidden rounded-xl bg-surface-3 sm:w-44">
              {"previewUrl" in state && state.previewUrl &&
                (field.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={state.previewUrl} alt="" className="size-full object-cover" />
                ) : (
                  <video src={state.previewUrl} muted playsInline className="size-full object-cover" />
                ))}
              {state.status === "uploading" && (
                <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/50">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.round(state.progress * 100)}%` }}
                  />
                </div>
              )}
              {state.status === "ready" && (
                <CheckCircle
                  weight="fill"
                  className="absolute start-2 top-2 size-5 text-status-green"
                />
              )}
              <button
                type="button"
                aria-label={t("removeUpload")}
                onClick={() => onChange({ status: "empty" })}
                className="absolute end-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-black/70 text-white hover:bg-black"
              >
                <X className="size-3" weight="bold" />
              </button>
            </div>
          )}
          {helper}
        </div>
      );
    }

    default:
      return (
        <div>
          {label}
          <p className="rounded-lg bg-surface-1 px-3 py-2 text-sm text-muted-foreground">
            {t("fieldNotSupported")}
          </p>
        </div>
      );
  }
}
