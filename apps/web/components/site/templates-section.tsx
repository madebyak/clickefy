"use client";

/**
 * Homepage templates rail — real published catalog, same public
 * `/v1/catalog` queries (and react-query cache keys) as the studio
 * gallery at /templates. Cards deep-link into the real run pages;
 * signed-out visitors land on sign-in first via the (studio) gate.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  Image as ImageIcon,
  Images,
  FilmSlate,
  VideoCamera,
  ArrowRight,
  type Icon,
} from "@phosphor-icons/react";
import type { CatalogTemplate } from "@clickfy/sdk";
import { useTemplateCategories, useTemplates } from "@/lib/use-templates";
import { cn } from "@/lib/utils";

/** How many cards the rail shows (3 rows of 5 on xl). */
const RAIL_SIZE = 15;

const KIND_META: Record<CatalogTemplate["kind"], { labelKey: string; Icon: Icon }> = {
  image: { labelKey: "typeImage", Icon: ImageIcon },
  set: { labelKey: "typeImageSet", Icon: Images },
  video_image: { labelKey: "typeImageVideo", Icon: FilmSlate },
  video: { labelKey: "typeVideo", Icon: VideoCamera },
};

function TemplateCard({
  template,
  categoryLabel,
}: {
  template: CatalogTemplate;
  categoryLabel?: string;
}) {
  const t = useTranslations("templates");
  const [hover, setHover] = useState(false);
  const meta = KIND_META[template.kind] ?? KIND_META.image;
  return (
    <Link
      href={`/templates/${template.id}`}
      className="group block overflow-hidden rounded-xl bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-surface-3">
        {/* Covers come from the API origin; the studio gallery uses a plain
            <img> for the same reason (rebased URLs in dev). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={template.coverImage}
          alt={template.title}
          loading="lazy"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {template.previewVideo && hover && (
          <video
            src={template.previewVideo}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-1 text-[11px] font-medium text-white backdrop-blur">
          <meta.Icon weight="fill" className="size-3.5" />
          {t(meta.labelKey)}
        </span>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium">{template.title}</p>
        {categoryLabel ? (
          <p className="truncate text-xs text-muted-foreground">{categoryLabel}</p>
        ) : null}
      </div>
    </Link>
  );
}

export function TemplatesSection() {
  const t = useTranslations("templates");
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);

  const categoriesQuery = useTemplateCategories();
  // Ask for exactly what the rail renders. It was fetching 50 rows to
  // show 15, over a public endpoint hit by every homepage visit.
  const templatesQuery = useTemplates({ categoryId, limit: RAIL_SIZE });

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const roots = categories.filter((c) => !c.parentId);
  const labelById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.label] as const)),
    [categories],
  );

  const items = (templatesQuery.data?.items ?? []).slice(0, RAIL_SIZE);

  // Marketing surface: if the catalog can't load, disappear quietly
  // rather than rendering a broken-looking empty rail.
  if (templatesQuery.isError || (templatesQuery.isSuccess && items.length === 0 && !categoryId)) {
    return null;
  }

  return (
    <section className="mx-auto mt-16 max-w-[90rem] px-4 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("heading")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("sub")}</p>
        </div>
        <Link
          href="/templates"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("viewAll")} <ArrowRight className="size-4 rtl:-scale-x-100" />
        </Link>
      </div>

      <div className="mt-6">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("allCategories")}
        </p>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setCategoryId(undefined)}
            className={cn(
              "shrink-0 rounded-full px-4 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              !categoryId
                ? "bg-primary text-primary-foreground"
                : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground",
            )}
          >
            {t("all")}
          </button>
          {roots.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(c.id === categoryId ? undefined : c.id)}
              className={cn(
                "shrink-0 rounded-full px-4 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                categoryId === c.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {templatesQuery.isLoading ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-10 text-center text-sm text-muted-foreground">{t("noResults")}</div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              categoryLabel={labelById.get(tpl.categoryIds[0] ?? tpl.categoryId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
