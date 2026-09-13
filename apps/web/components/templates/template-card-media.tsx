"use client";

import { useEffect, useState } from "react";
import type { CatalogTemplate } from "@clickfy/sdk";
import { responsiveImage } from "@/lib/image-url";
import { cn } from "@/lib/utils";

/** How long each image of a set holds on a hovered card. */
const CYCLE_MS = 1100;

/** The card grids: two columns on phones, up to five on wide screens. */
const CARD_SIZES = "(min-width: 1280px) 20vw, (min-width: 768px) 33vw, 50vw";

/**
 * The picture half of a template card, shared by the /templates gallery and
 * the homepage rail so both preview every kind the same way:
 *   - image: the cover
 *   - video: the cover, playing the preview clip while hovered
 *   - image set: the cover, cycling through the set while hovered with one
 *     segment per image — the set's equivalent of the video preview. Before
 *     this, a set only ever showed its first image.
 *
 * Set images mount on first hover, so a grid full of sets costs nothing
 * until someone looks. Plain <img> with a Cloudflare `srcset` rather than
 * next/image: the media is already resized at the API's edge.
 */
export function TemplateCardMedia({ template, hover }: { template: CatalogTemplate; hover: boolean }) {
  const set = template.kind === "set" && (template.gallery?.length ?? 0) > 1 ? template.gallery! : null;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!set || !hover) return;
    // A card that changes on its own is the movement "reduce motion" asks
    // us to stop; those visitors see the whole set on the template page.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % set.length), CYCLE_MS);
    return () => {
      clearInterval(id);
      setIndex(0);
    };
  }, [set, hover]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...responsiveImage(template.coverImage, CARD_SIZES)}
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

      {set && hover && (
        <>
          {set.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${i}-${src}`}
              {...responsiveImage(src, CARD_SIZES)}
              alt=""
              className={cn(
                "absolute inset-0 size-full object-cover transition-opacity duration-500",
                i === index ? "opacity-100" : "opacity-0",
              )}
            />
          ))}
          <div aria-hidden className="absolute inset-x-2 bottom-2 flex gap-1">
            {set.map((src, i) => (
              <span
                key={`${i}-${src}`}
                className={cn(
                  "h-0.5 flex-1 rounded-full transition-colors duration-300",
                  i === index ? "bg-white" : "bg-white/35",
                )}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
