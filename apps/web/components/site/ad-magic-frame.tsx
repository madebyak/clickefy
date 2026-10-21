"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The phone in the Ad Magic section cycles through three frames made with
 * the studio's own models, in the styles the most-run templates sell
 * (perfume stage, sneaker burst, skincare splash) — the kind of shot the
 * tool turns into a commercial. Same crossfade discipline as the hero:
 * only the frames seen so far are mounted, and "reduce motion" keeps
 * frame one.
 */
const FRAMES = [
  "/assets/new/ad-magic-perfume.jpg",
  "/assets/new/ad-magic-sneaker.jpg",
  "/assets/new/ad-magic-skincare.jpg",
] as const;
const SLIDE_MS = 4000;

export function AdMagicFrame() {
  const [index, setIndex] = useState(0);
  const [mounted, setMounted] = useState(2);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % FRAMES.length), SLIDE_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    setMounted((n) => Math.max(n, Math.min(FRAMES.length, index + 2)));
  }, [index]);

  return (
    <div className="absolute inset-0">
      {FRAMES.slice(0, mounted).map((src, i) => (
        <Image
          key={src}
          src={src}
          alt=""
          fill
          sizes="260px"
          loading={i === 0 ? "eager" : "lazy"}
          className={cn(
            "object-cover transition-opacity duration-1000 ease-in-out motion-reduce:transition-none",
            i === index ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
    </div>
  );
}
