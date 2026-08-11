"use client";

/**
 * Template run page — dynamic form from the template's admin-defined
 * `userInputs`, media uploads to R2, then the same versioned pipeline
 * mobile runs (`POST /v1/jobs`), filed into the active project.
 */

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { toast } from "sonner";
import { ArrowLeft, Lightning, Sparkle } from "@phosphor-icons/react";
import { JobSubmissionError, RateLimitedError } from "@clickfy/sdk";
import type { JobInputValue } from "@clickfy/types";
import { useTemplate } from "@/lib/use-templates";
import { useStudio } from "@/components/studio/studio-context";
import { InputField, type FieldState } from "@/components/templates/input-field";

const SUPPORTED = new Set(["text", "textarea", "select", "image", "video"]);

export default function TemplateRunPage() {
  const t = useTranslations("templates");
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const templateQuery = useTemplate(id);
  const { startTemplateJob } = useStudio();

  const [fields, setFields] = useState<Record<string, FieldState>>({});
  const [submitting, setSubmitting] = useState(false);

  const template = templateQuery.data;
  const inputs = useMemo(
    () => [...(template?.userInputs ?? [])].sort((a, b) => a.order - b.order),
    [template?.userInputs],
  );

  const fieldState = (key: string): FieldState => fields[key] ?? { status: "empty" };
  const uploadsInFlight = inputs.some((f) => fieldState(f.fieldKey).status === "uploading");
  const missingRequired = inputs.some(
    (f) =>
      f.required && SUPPORTED.has(f.type) && fieldState(f.fieldKey).status !== "ready",
  );
  const canGenerate = !!template && !submitting && !uploadsInFlight && !missingRequired;

  const onGenerate = async () => {
    if (!template || !canGenerate) return;
    const jobInputs: Record<string, JobInputValue> = {};
    for (const f of inputs) {
      const s = fieldState(f.fieldKey);
      if (s.status === "ready") jobInputs[f.fieldKey] = s.value;
    }
    setSubmitting(true);
    try {
      await startTemplateJob({
        templateId: template.id,
        inputs: jobInputs,
        kind: template.kind === "video" || template.kind === "video_image" ? "video" : "image",
      });
      toast.success(t("runStarted"));
      router.push("/create");
    } catch (err) {
      if (err instanceof JobSubmissionError && err.code === "insufficient_credits") {
        toast.error(t("insufficientCredits"));
      } else if (err instanceof RateLimitedError) {
        toast.error(t("rateLimited", { seconds: err.retryAfterSeconds }));
      } else {
        toast.error(t("runFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (templateQuery.isLoading) {
    return (
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
          <div className="aspect-[3/4] animate-pulse rounded-2xl bg-surface-2" />
          <div className="space-y-4">
            <div className="h-8 w-2/3 animate-pulse rounded-lg bg-surface-2" />
            <div className="h-24 animate-pulse rounded-xl bg-surface-2" />
            <div className="h-24 animate-pulse rounded-xl bg-surface-2" />
          </div>
        </div>
      </main>
    );
  }

  if (!template) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted-foreground">{t("notFound")}</p>
        <Link href="/templates" className="text-sm text-primary hover:underline">
          {t("backToGallery")}
        </Link>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/templates"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t("backToGallery")}
        </Link>

        <div className="mt-4 grid gap-8 lg:grid-cols-2">
          {/* preview */}
          <div className="overflow-hidden rounded-2xl bg-surface-2">
            {template.previewVideo ? (
              <video
                src={template.previewVideo}
                poster={template.coverImage}
                autoPlay
                muted
                loop
                playsInline
                className="w-full object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={template.coverImage} alt={template.title} className="w-full object-cover" />
            )}
          </div>

          {/* form */}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{template.title}</h1>
            {template.description && (
              <p className="mt-2 text-sm text-muted-foreground">{template.description}</p>
            )}

            <div className="mt-6 space-y-5">
              {inputs.map((f) => (
                <InputField
                  key={f.fieldKey}
                  field={f}
                  state={fieldState(f.fieldKey)}
                  onChange={(next) => setFields((prev) => ({ ...prev, [f.fieldKey]: next }))}
                />
              ))}
              {inputs.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("noInputsNeeded")}</p>
              )}
            </div>

            <button
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate}
              className="mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40"
            >
              {submitting ? t("running") : t("run")}
              <Sparkle weight="fill" className="size-4" />
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Lightning weight="fill" className="size-4" />
                {template.credits}
              </span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
