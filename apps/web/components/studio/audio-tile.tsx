"use client";

/**
 * How an audio asset shows up where images and videos show up: a tile
 * in the grid, a player in the lightbox. No waveform is stored for an
 * output (the file is the asset), so the bars are a deterministic
 * pattern from the asset id: stable across renders, different per clip,
 * honest about being decoration.
 */

import { useEffect, useRef, useState } from "react";
import { Pause, Play, SpeakerHigh } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

const BAR_COUNT = 32;

function barsFor(seed: string): number[] {
  let h = 2166136261;
  const out: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    out.push(0.25 + ((h % 1000) / 1000) * 0.75);
  }
  return out;
}

/** 7.4 → "0:07", 125 → "2:05". */
export function formatClip(sec?: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useAudio(src: string) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const el = new Audio(src);
    el.preload = "metadata";
    ref.current = el;
    const onTime = () => setProgress(el.duration ? el.currentTime / el.duration : 0);
    const onEnd = () => { setPlaying(false); setProgress(0); };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    el.addEventListener("pause", () => setPlaying(false));
    el.addEventListener("play", () => setPlaying(true));
    return () => { el.pause(); el.removeEventListener("timeupdate", onTime); el.removeEventListener("ended", onEnd); ref.current = null; };
  }, [src]);
  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };
  return { playing, progress, toggle };
}

export function AudioTile({ id, src, durationSec, className }: { id: string; src: string; durationSec?: number | null; className?: string }) {
  const bars = barsFor(id);
  const { playing, progress, toggle } = useAudio(src);
  return (
    <div className={cn("relative flex size-full items-center gap-3 bg-gradient-to-br from-primary/25 via-surface-2 to-surface-3 px-4", className)}>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-white/90 text-black shadow transition-transform hover:scale-105"
      >
        {playing ? <Pause weight="fill" className="size-4" /> : <Play weight="fill" className="size-4 translate-x-px" />}
      </button>
      <div className="flex h-10 min-w-0 flex-1 items-center gap-px" aria-hidden>
        {bars.map((b, i) => (
          <span
            key={i}
            className={cn("w-full rounded-full", i / BAR_COUNT < progress ? "bg-primary" : "bg-white/35")}
            style={{ height: `${b * 100}%` }}
          />
        ))}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-white/80">{formatClip(durationSec) || <SpeakerHigh className="size-3.5" />}</span>
    </div>
  );
}

export function AudioPlayer({ id, src, durationSec }: { id: string; src: string; durationSec?: number | null }) {
  const bars = barsFor(id);
  return (
    <div className="w-full rounded-xl bg-surface-2 p-5">
      <div className="mb-4 flex h-24 items-center gap-0.5" aria-hidden>
        {bars.map((b, i) => (
          <span key={i} className="w-full rounded-full bg-primary/60" style={{ height: `${b * 100}%` }} />
        ))}
      </div>
      {/* The browser's own transport: seek, volume, download all come for free. */}
      <audio key={id} src={src} controls preload="metadata" className="w-full" />
      {durationSec ? <p className="mt-2 text-end text-xs text-muted-foreground">{formatClip(durationSec)}</p> : null}
    </div>
  );
}
