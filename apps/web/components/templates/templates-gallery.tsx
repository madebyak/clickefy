"use client";

/**
 * Public template gallery body — admin-managed promo banner on top,
 * then search + category + kind filters over the full published
 * catalog. Client component; the /templates route wraps it in the
 * marketing shell (Navbar/Footer stay server-rendered).
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  CircleNotch,
  X,
} from "@phosphor-icons/react";
import type { CatalogTemplate } from "@clickfy/sdk";
import type { MobileHomeBanner } from "@clickfy/types";
import { Input } from "@/components/ui/input";
import { useTemplateCategories, useInfiniteTemplates } from "@/lib/use-templates";
import { useBanners } from "@/lib/use-banners";
import { cn } from "@/lib/utils";
import { TemplateCardMedia } from "@/components/templates/template-card-media";

type KindFilter = "image" | "image_set" | "video" | "video_image";

const KIND_FILTERS: Array<{ value: KindFilter; labelKey: string; Icon: typeof ImageSquare }> = [
  { value: "image", labelKey: "typeImage", Icon: ImageSquare },
  { value: "image_set", labelKey: "typeImageSet", Icon: Stack },
  { value: "video", labelKey: "typeVideo", Icon: VideoCamera },
  { value: "video_image", labelKey: "typeImageVideo", Icon: FilmSlate },
];

/** `/templates?type=video` opens the gallery on that kind (homepage deep links). */
const KIND_PARAM = "type";
/** `/templates?q=retro` opens the gallery on that search — refreshable and shareable. */
const SEARCH_PARAM = "q";
/** Pause after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 300;

const parseKind = (value: string | null): KindFilter | undefined =>
  KIND_FILTERS.find((f) => f.value === value)?.value;

/**
 * Renders nothing. Mirrors the URL into the gallery's filters. Isolated
 * behind its own Suspense boundary because `useSearchParams` suspends
 * during prerender (same shape as ToolDeepLink in tools-context.tsx).
 *
 * `?type=` is followed on arrival AND whenever the chips rewrite it.
 * `?q=` is read once, on arrival: afterwards the input owns the search
 * and writes the URL itself, so feeding the URL back would overwrite
 * letters typed while the debounced write was still pending.
 */
function FiltersFromUrl({
  onKind,
  onInitialSearch,
}: {
  onKind: (kind: KindFilter | undefined) => void;
  onInitialSearch: (query: string) => void;
}) {
  const params = useSearchParams();
  const type = params.get(KIND_PARAM);
  const initialSearch = useRef(params.get(SEARCH_PARAM) ?? "");
  useEffect(() => {
    if (initialSearch.current) onInitialSearch(initialSearch.current);
  }, [onInitialSearch]);
  useEffect(() => {
    onKind(parseKind(type));
  }, [type, onKind]);
  return null;
}

/**
 * Kind at a glance. A set also shows how many images it holds: hovering
 * reveals them on a pointer device, but a phone never hovers.
 */
function KindBadge({ kind, count }: { kind: CatalogTemplate["kind"]; count?: number }) {
  const Icon =
    kind === "video" || kind === "video_image" ? VideoCamera : kind === "set" ? Stack : ImageSquare;
  const setCount = kind === "set" && count && count > 1 ? count : null;
  return (
    <span
      className={cn(
        "absolute start-2 top-2 inline-flex h-7 items-center justify-center gap-1 rounded-lg bg-black/55 text-white backdrop-blur",
        setCount ? "px-2" : "w-7",
      )}
    >
      <Icon weight="fill" className="size-3.5" />
      {setCount && <span className="text-xs font-medium tabular-nums">{setCount}</span>}
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
        <TemplateCardMedia template={template} hover={hover} />
        <KindBadge kind={template.kind} count={template.gallery?.length} />
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
  // The page is prerendered, so `?type=` is only known after hydration.
  // Hold the catalog request until then, or a deep link to video
  // templates would first fetch (and flash) the unfiltered catalog.
  const [kindReady, setKindReady] = useState(false);
  const applyUrlKind = useCallback((next: KindFilter | undefined) => {
    setKind(next);
    setKindReady(true);
  }, []);

  // The URL is the filter's source of truth, so a chosen kind survives
  // refresh and can be shared. replaceState syncs with useSearchParams,
  // which feeds the choice back through KindFromUrl.
  const selectKind = useCallback((next: KindFilter | undefined) => {
    setKind(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set(KIND_PARAM, next);
    else url.searchParams.delete(KIND_PARAM);
    window.history.replaceState(null, "", url);
  }, []);

  // `search` is the input; `query` is what we fetch with. Debounced so each
  // keystroke doesn't spawn a request — except a search arriving from the
  // URL, which applies at once so a shared link never flashes the full
  // catalog first.
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (search === query) return;
    const id = window.setTimeout(() => setQuery(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [search, query]);
  const applyUrlSearch = useCallback((q: string) => {
    setSearch(q);
    setQuery(q);
  }, []);
  // On the wrapper: the shared Input doesn't forward refs.
  const searchBox = useRef<HTMLDivElement>(null);
  const clearSearch = useCallback(() => {
    setSearch("");
    setQuery("");
    searchBox.current?.querySelector("input")?.focus();
  }, []);

  // Write the settled search into the URL (replace, not push: a history
  // entry per word would make Back unusable).
  useEffect(() => {
    if (!kindReady) return;
    const url = new URL(window.location.href);
    const next = query.trim();
    if ((url.searchParams.get(SEARCH_PARAM) ?? "") === next) return;
    if (next) url.searchParams.set(SEARCH_PARAM, next);
    else url.searchParams.delete(SEARCH_PARAM);
    window.history.replaceState(null, "", url);
  }, [query, kindReady]);

  const categoriesQuery = useTemplateCategories();
  const templatesQuery = useInfiniteTemplates({
    categoryId,
    search: query,
    kind,
    enabled: kindReady,
  });
  const searching = query.trim().length > 0;
  const total = templatesQuery.data?.pages[0]?.total;
  // A refetch for a new query or filter, not a "load more".
  const refreshing = templatesQuery.isFetching && !templatesQuery.isFetchingNextPage;

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
    <main className="mx-auto w-full max-w-site py-8 site-px">
      <Suspense fallback={null}>
        <FiltersFromUrl onKind={applyUrlKind} onInitialSearch={applyUrlSearch} />
      </Suspense>
      <PromoBanner onSelectCategory={(id) => setCategoryId(id)} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("galleryHeading")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("gallerySub")}</p>
          </div>
          <div ref={searchBox} role="search" className="relative w-full sm:w-72">
            <MagnifyingGlass className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && search) {
                  e.preventDefault();
                  clearSearch();
                }
              }}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              className="ps-9 pe-10"
            />
            <div className="absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center">
              {searching && refreshing ? (
                <CircleNotch aria-hidden className="m-1.5 size-4 animate-spin text-muted-foreground" />
              ) : search ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label={t("clearSearch")}
                  className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <X className="size-3.5" weight="bold" />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* kind filter */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => selectKind(undefined)}
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
              onClick={() => selectKind(kind === value ? undefined : value)}
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

        {/* result count — announced politely so screen readers hear it settle */}
        <p aria-live="polite" className="mt-6 min-h-5 text-sm text-muted-foreground tabular-nums">
          {searching && total !== undefined && !templatesQuery.isPlaceholderData
            ? t("searchResults", { count: total })
            : ""}
        </p>

        {/* grid */}
        {!kindReady || templatesQuery.isLoading ? (
          <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-14 flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
            <p>{searching ? t("noResultsFor", { query: query.trim() }) : t("noResults")}</p>
            {searching && (
              <button
                type="button"
                onClick={clearSearch}
                className="inline-flex h-9 items-center rounded-full border border-border bg-surface-1 px-4 font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                {t("clearSearch")}
              </button>
            )}
          </div>
        ) : (
          <div
            className={cn(
              "mt-2 grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
              templatesQuery.isPlaceholderData && "opacity-60",
            )}
          >
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
