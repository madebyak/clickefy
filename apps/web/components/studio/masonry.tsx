"use client";

import { useState } from "react";
import { ArrowsOutSimple, DownloadSimple, X } from "@phosphor-icons/react";

function downloadImage(src: string) {
  const a = document.createElement("a");
  a.href = src;
  a.download = src.split("/").pop() ?? "image";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function OverlayButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/80"
    >
      {children}
    </button>
  );
}

/**
 * Pinterest-style masonry. Images keep their natural ratio (CSS multi-column).
 * Each tile has hover actions (expand / download); expand opens a lightbox.
 */
export function Masonry({ images }: { images: string[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <>
      <div className="columns-2 gap-3 md:columns-3 2xl:columns-4">
        {images.map((src, i) => (
          <div
            key={`${src}-${i}`}
            className="group relative mb-3 break-inside-avoid overflow-hidden rounded-xl bg-surface-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" loading="lazy" className="w-full" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="absolute end-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              <OverlayButton label="Expand" onClick={() => setLightbox(src)}>
                <ArrowsOutSimple className="size-4" />
              </OverlayButton>
              <OverlayButton label="Download" onClick={() => downloadImage(src)}>
                <DownloadSimple className="size-4" />
              </OverlayButton>
            </div>
          </div>
        ))}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="absolute end-4 top-4 flex gap-2">
            <button
              type="button"
              aria-label="Download"
              onClick={(e) => {
                e.stopPropagation();
                downloadImage(lightbox);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-surface-3 px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              <DownloadSimple className="size-4" /> Download
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setLightbox(null)}
              className="grid size-10 place-items-center rounded-lg bg-surface-3 text-foreground transition-colors hover:bg-surface-2"
            >
              <X className="size-5" />
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt=""
            className="max-h-[88vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
