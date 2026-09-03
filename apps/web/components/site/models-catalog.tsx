"use client";

/**
 * The /models catalogue — every model you can generate with, grouped
 * image / video, with the real per-generation price.
 *
 * Same data rule as the pricing table: every number comes from
 * `GET /v1/billing/plans` (the same `provider_models` rows the job
 * route charges against), never from a constant in the web app. Prices
 * are quoted at each model's default quality and clip length — what it
 * costs to press Generate without touching a setting.
 */

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ImageSquare, FilmSlate, ArrowRight } from "@phosphor-icons/react";

import { usePlans, type CatalogueModel } from "@/lib/use-plans";

function ModelCard({ model }: { model: CatalogueModel }) {
  const t = useTranslations("modelsPage");
  const spec = [model.quality, model.seconds ? `${model.seconds}s` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col justify-between gap-4 rounded-2xl bg-surface-1 p-5 ring-1 ring-border transition-colors hover:ring-surface-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium text-foreground">{model.name}</h3>
          {model.preview && (
            <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("preview")}
            </span>
          )}
        </div>
        {spec && <p className="mt-1 text-xs text-muted-foreground">{spec}</p>}
      </div>
      <p className="text-sm text-muted-foreground">
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {model.credits}
        </span>{" "}
        {t("creditsPerGeneration")}
      </p>
    </div>
  );
}

function ModelGroup({
  titleKey,
  subKey,
  icon,
  models,
  ctaHref,
  ctaKey,
}: {
  titleKey: string;
  subKey: string;
  icon: React.ReactNode;
  models: CatalogueModel[];
  ctaHref: string;
  ctaKey: string;
}) {
  const t = useTranslations("modelsPage");
  if (models.length === 0) return null;

  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight sm:text-2xl">
            {icon}
            {t(titleKey)}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{t(subKey)}</p>
        </div>
        <Link
          href={ctaHref}
          className="flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-foreground"
        >
          {t(ctaKey)}
          <ArrowRight className="size-4 rtl:-scale-x-100" />
        </Link>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {models.map((m) => (
          <ModelCard key={m.key} model={m} />
        ))}
      </div>
    </section>
  );
}

export function ModelsCatalog() {
  const t = useTranslations("modelsPage");
  const { data, isLoading } = usePlans();

  const models = data?.models ?? [];
  const images = models.filter((m) => m.kind === "image");
  const videos = models.filter((m) => m.kind === "video");

  if (isLoading) {
    return (
      <div className="mx-auto mt-16 w-full max-w-site site-px">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface-1" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-site site-px">
      <ModelGroup
        titleKey="groupImages"
        subKey="groupImagesSub"
        icon={<ImageSquare weight="fill" className="size-5 text-primary" />}
        models={images}
        ctaHref="/create"
        ctaKey="tryImages"
      />
      <ModelGroup
        titleKey="groupVideo"
        subKey="groupVideoSub"
        icon={<FilmSlate weight="fill" className="size-5 text-[#b98aff]" />}
        models={videos}
        ctaHref="/create-video"
        ctaKey="tryVideo"
      />
      <p className="mt-10 text-center text-xs text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}
