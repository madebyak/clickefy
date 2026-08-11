"use client";

/**
 * Template gallery — the same published catalog the mobile app runs,
 * served by the public `/v1/catalog` endpoints (localized, cached).
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { MagnifyingGlass, ImageSquare, VideoCamera, Stack, Lightning } from "@phosphor-icons/react";
import type { CatalogTemplate } from "@clickfy/sdk";
import { Input } from "@/components/ui/input";
import { useTemplateCategories, useTemplates } from "@/lib/use-templates";
import { cn } from "@/lib/utils";

function KindBadge({ kind }: { kind: CatalogTemplate["kind"] }) {
  const Icon = kind === "video" || kind === "video_image" ? VideoCamera : kind === "set" ? Stack : ImageSquare;
  return (
    <span className="absolute start-2 top-2 grid size-7 place-items-center rounded-lg bg-black/55 text-white backdrop-blur">
      <Icon weight="fill" className="size-3.5" />
    </span>
  );
}

function TemplateCard({ template }: { template: CatalogTemplate }) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={`/templates/${template.id}`}
      className="group block overflow-hidden rounded-xl bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-surface-3">
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
        <KindBadge kind={template.kind} />
        <span className="absolute end-2 top-2 inline-flex items-center gap-1 rounded-lg bg-black/55 px-2 py-1 text-xs font-medium text-white backdrop-blur">
          <Lightning weight="fill" className="size-3 text-primary" />
          {template.credits}
        </span>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium">{template.title}</p>
      </div>
    </Link>
  );
}

export default function TemplatesPage() {
  const t = useTranslations("templates");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);

  const categoriesQuery = useTemplateCategories();
  const templatesQuery = useTemplates({ categoryId, search });

  // Root categories only — sub-categories stay a mobile drill-down for now.
  const roots = (categoriesQuery.data ?? []).filter((c) => !c.parentId);
  const items = templatesQuery.data?.items ?? [];

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-[90rem]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("galleryHeading")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("gallerySub")}</p>
          </div>
          <div className="relative w-full sm:w-72">
            <MagnifyingGlass className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="ps-9"
            />
          </div>
        </div>

        {/* category chips */}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategoryId(undefined)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              !categoryId
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
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
                "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                categoryId === c.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* grid */}
        {templatesQuery.isLoading ? (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-16 text-center text-sm text-muted-foreground">{t("noResults")}</div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((tpl) => (
              <TemplateCard key={tpl.id} template={tpl} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
