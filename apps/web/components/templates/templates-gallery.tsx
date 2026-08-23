"use client";

/**
 * Public template gallery body — admin-managed promo banner on top,
 * then search + category + kind filters over the full published
 * catalog. Client component; the /templates route wraps it in the
 * marketing shell (Navbar/Footer stay server-rendered).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  MagnifyingGlass,
  ImageSquare,
  VideoCamera,
  Stack,
  FilmSlate,
  Lightning,
  ArrowRight,
} from "@phosphor-icons/react";
import type { CatalogTemplate } from "@clickfy/sdk";
import type { MobileHomeBanner } from "@clickfy/types";
import { Input } from "@/components/ui/input";
import { useTemplateCategories, useInfiniteTemplates } from "@/lib/use-templates";
import { useBanners } from "@/lib/use-banners";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";

type KindFilter = "image" | "image_set" | "video" | "video_image";

const KIND_FILTERS: Array<{ value: KindFilter; labelKey: string; Icon: typeof ImageSquare }> = [
  { value: "image", labelKey: "typeImage", Icon: ImageSquare },
  { value: "image_set", labelKey: "typeImageSet", Icon: Stack },
  { value: "video", labelKey: "typeVideo", Icon: VideoCamera },
  { value: "video_image", labelKey: "typeImageVideo", Icon: FilmSlate },
];

function KindBadge({ kind }: { kind: CatalogTemplate["kind"] }) {
  const Icon =
    kind === "video" || kind === "video_image" ? VideoCamera : kind === "set" ? Stack : ImageSquare;
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

/**
 * Narrow promo strip fed by the admin's Home Banners. Renders the
 * first live banner; disappears entirely when none are active.
 */
function PromoBanner({ onSelectCategory }: { onSelectCategory: (id: string) => void }) {
  const bannersQuery = useBanners();
  const router = useRouter();
  const banner: MobileHomeBanner | undefined = bannersQuery.data?.[0];
  if (!banner) return null;

  const mediaUrl =
    banner.kind === "image"
      ? banner.image.url
      : banner.kind === "image_slider"
        ? banner.images[0]?.url
        : banner.video.posterUrl;

  const handleCta = () => {
    const { kind, target } = banner.cta;
    if (!target) return;
    if (kind === "template") router.push(`/templates/${target}`);
    else if (kind === "category") onSelectCategory(target);
    else if (kind === "external_url") window.open(target, "_blank", "noopener,noreferrer");
  };

  const hasCta = banner.cta.kind !== "none" && banner.cta.target;

  // <video src> can't play HLS manifests outside Safari; the pipeline
  // currently delivers progressive MP4s, but if an .m3u8 ever ships we
  // degrade to the poster image instead of a broken player.
  const isHls = banner.kind === "video" && /\.m3u8(\?|$)/.test(banner.video.hlsUrl);

  return (
    <div className="relative mb-8 h-36 overflow-hidden rounded-2xl bg-surface-2 sm:h-44">
      {banner.kind === "video" && !isHls ? (
        <video
          src={banner.video.hlsUrl}
          poster={banner.video.posterUrl}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 size-full object-cover"
        />
      ) : mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrl} alt={banner.title ?? ""} className="absolute inset-0 size-full object-cover" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-transparent" />
      <div className="relative flex h-full flex-col justify-center gap-1 px-6 sm:px-8">
        {banner.title ? (
          <p className="max-w-xl text-lg font-semibold text-white sm:text-2xl">{banner.title}</p>
        ) : null}
        {banner.subtitle ? (
          <p className="max-w-xl text-sm text-white/75">{banner.subtitle}</p>
        ) : null}
        {hasCta ? (
          <button
            type="button"
            onClick={handleCta}
            className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {banner.cta.label ?? ""}
            <ArrowRight className="size-4 rtl:-scale-x-100" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TemplatesGallery() {
  const t = useTranslations("templates");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<KindFilter | undefined>(undefined);

  // Debounce so each keystroke doesn't spawn a request / query key.
  const debouncedSearch = useDebouncedValue(search, 300);
  const categoriesQuery = useTemplateCategories();
  const templatesQuery = useInfiniteTemplates({ categoryId, search: debouncedSearch, kind });

  const roots = useMemo(
    () => (categoriesQuery.data ?? []).filter((c) => !c.parentId),
    [categoriesQuery.data],
  );
  const items = useMemo(
    () => (templatesQuery.data?.pages ?? []).flatMap((p) => p.items),
    [templatesQuery.data],
  );

  // Fetch the next page when a sentinel below the grid scrolls into
  // view. `rootMargin` starts the request before it is visible, so the
  // grid grows without the user ever reaching an empty bottom.
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = templatesQuery;
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-8 sm:px-6">
      <PromoBanner onSelectCategory={(id) => setCategoryId(id)} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("galleryHeading")}
            </h1>
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

        {/* kind filter */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setKind(undefined)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              !kind
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
            )}
          >
            {t("typeAll")}
          </button>
          {KIND_FILTERS.map(({ value, labelKey, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(kind === value ? undefined : value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                kind === value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon weight="fill" className="size-3.5" />
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* category chips */}
        <div className="mt-3 flex flex-wrap gap-2">
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
            {/* Placeholders for the page in flight, so the grid grows
                rather than jumping when it lands. */}
            {isFetchingNextPage &&
              Array.from({ length: 5 }, (_, i) => (
                <div
                  key={`more-${i}`}
                  className="aspect-[3/4] animate-pulse rounded-xl bg-surface-2"
                />
              ))}
          </div>
        )}

        {/* Intersection sentinel — rendered only while more pages exist. */}
        {hasNextPage && <div ref={sentinelRef} aria-hidden className="h-px w-full" />}

        {/* The scroll trigger is an optimisation, not the only way down.
            IntersectionObserver delivers nothing while the document is
            hidden, and pure infinite scroll strands keyboard and
            screen-reader users with no way to reach the rest of the
            catalog at all. So the manual control is always present while
            more pages exist; the observer just usually gets there first. */}
        {hasNextPage && (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={isFetchingNextPage}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-surface-1 px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              {isFetchingNextPage ? t("loadingMore") : t("loadMore")}
            </button>
          </div>
        )}
    </main>
  );
}
