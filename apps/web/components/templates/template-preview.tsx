"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { CatalogTemplate } from "@clickfy/sdk";
import { responsiveImage } from "@/lib/image-url";
import { cn } from "@/lib/utils";

/** The preview column: half of the page's max-w-4xl on desktop, full width below. */
const PREVIEW_SIZES = "(min-width: 1024px) 448px, 100vw";

/**
 * The template page's preview. A template with more than one gallery image
 * shows the whole set as a swipeable carousel — the web counterpart of the
 * mobile detail screen's paged hero, and the same rule it uses — where before
 * the page showed only the cover. Video templates play their preview; single
 * images show the cover.
 */
export function TemplatePreview({ template }: { template: CatalogTemplate }) {
  const gallery = template.gallery ?? [];
  if (gallery.length > 1) return <SetCarousel images={gallery} title={template.title} />;

  return (
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
        <img
          {...responsiveImage(template.coverImage, PREVIEW_SIZES)}
          alt={template.title}
          className="w-full object-cover"
        />
      )}
    </div>
  );
}

function SetCarousel({ images, title }: { images: string[]; title: string }) {
  const t = useTranslations("templates");
  const scroller = useRef<HTMLDivElement>(null);
  const slides = useRef<Array<HTMLDivElement | null>>([]);
  const [active, setActive] = useState(0);
  /** The first image's own proportions, so the frame never crops the set. */
  const [ratio, setRatio] = useState<number | null>(null);

  // Which slide is showing, read from layout rather than scroll maths:
  // scrollLeft runs negative in right-to-left pages; an observer does not care.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { root, threshold: 0.6 },
    );
    slides.current.forEach((slide) => slide && observer.observe(slide));
    return () => observer.disconnect();
  }, [images]);

  const go = (i: number) => {
    const target = slides.current[Math.max(0, Math.min(images.length - 1, i))];
    target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  };

  // Arrow keys follow the page's reading direction.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const forward = (e.key === "ArrowRight") !== rtl;
    go(active + (forward ? 1 : -1));
  };

  return (
    <div>
      <div className="relative">
        <div
          ref={scroller}
          tabIndex={0}
          role="region"
          aria-roledescription="carousel"
          aria-label={title}
          onKeyDown={onKeyDown}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-2xl bg-surface-2 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-scrollbar]:hidden"
          style={{ aspectRatio: ratio ?? 4 / 5 }}
        >
          {images.map((src, i) => (
            <div
              key={`${i}-${src}`}
              ref={(el) => {
                slides.current[i] = el;
              }}
              data-index={i}
              aria-roledescription="slide"
              aria-label={`${i + 1} / ${images.length}`}
              className="relative w-full shrink-0 snap-start"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                {...responsiveImage(src, PREVIEW_SIZES)}
                alt={i === 0 ? title : ""}
                loading={i === 0 ? "eager" : "lazy"}
                draggable={false}
                onLoad={
                  i === 0
                    ? (e) => {
                        const img = e.currentTarget;
                        if (img.naturalWidth) setRatio(img.naturalWidth / img.naturalHeight);
                      }
                    : undefined
                }
                className="size-full object-cover"
              />
            </div>
          ))}
        </div>

        {/* Digits read the same in every locale. */}
        <span
          dir="ltr"
          className="absolute end-3 top-3 rounded-md bg-black/55 px-2 py-1 text-xs font-medium tabular-nums text-white backdrop-blur"
        >
          {active + 1} / {images.length}
        </span>

        <button
          type="button"
          onClick={() => go(active - 1)}
          disabled={active === 0}
          aria-label={t("prevImage")}
          className="absolute start-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-opacity hover:bg-black/70 disabled:pointer-events-none disabled:opacity-0"
        >
          <CaretLeft weight="bold" className="size-4 rtl:-scale-x-100" />
        </button>
        <button
          type="button"
          onClick={() => go(active + 1)}
          disabled={active === images.length - 1}
          aria-label={t("nextImage")}
          className="absolute end-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-opacity hover:bg-black/70 disabled:pointer-events-none disabled:opacity-0"
        >
          <CaretRight weight="bold" className="size-4 rtl:-scale-x-100" />
        </button>
      </div>

      <div className="mt-3 flex justify-center gap-1.5">
        {images.map((src, i) => (
          <button
            key={`${i}-${src}`}
            type="button"
            onClick={() => go(i)}
            aria-label={t("showImage", { n: i + 1 })}
            aria-current={i === active}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              i === active ? "w-5 bg-foreground" : "w-1.5 bg-foreground/30 hover:bg-foreground/60",
            )}
          />
        ))}
      </div>
    </div>
  );
}
