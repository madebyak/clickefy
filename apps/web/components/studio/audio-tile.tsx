"use client";

/**
 * How an audio asset shows up where images and videos show up: a square
 * tile in the grid and a player in the lightbox. The waveform is the real
 * one — wavesurfer.js fetches the clip, decodes it and draws the bars —
 * so two clips never look alike and the progress runs along the actual
 * sound. One decode per mounted tile; the grid holds a handful at most.
 */

import { useEffect, useRef, useState } from "react";
import { Pause, Play, SpeakerHigh } from "@phosphor-icons/react";
import WaveSurfer from "wavesurfer.js";

import { cn } from "@/lib/utils";

/** 7.4 → "0:07", 125 → "2:05". */
export function formatClip(sec?: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Look = "tile" | "player";

const LOOK: Record<Look, { height: number; barWidth: number; barGap: number; barRadius: number }> = {
  tile: { height: 56, barWidth: 3, barGap: 2, barRadius: 3 },
  player: { height: 96, barWidth: 4, barGap: 3, barRadius: 4 },
};

/**
 * One wavesurfer instance bound to a container. Returns playback state
 * and controls; the instance is destroyed with the element.
 */
function useWave(src: string, look: Look, interact: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const style = getComputedStyle(document.documentElement);
    const primary = style.getPropertyValue("--color-primary").trim() || "#4ade80";
    const ws = WaveSurfer.create({
      container: el,
      url: src,
      ...LOOK[look],
      waveColor: "rgba(255,255,255,0.35)",
      progressColor: primary,
      cursorWidth: 0,
      normalize: true,
      interact,
      dragToSeek: interact,
      fillParent: true,
    });
    wsRef.current = ws;
    const unsubs = [
      ws.on("ready", (d) => { setReady(true); setDuration(d); }),
      ws.on("play", () => setPlaying(true)),
      ws.on("pause", () => setPlaying(false)),
      ws.on("finish", () => { setPlaying(false); ws.seekTo(0); }),
      ws.on("timeupdate", (t) => setCurrent(t)),
      ws.on("error", () => setReady(false)),
    ];
    return () => {
      unsubs.forEach((u) => u());
      ws.destroy();
      wsRef.current = null;
    };
  }, [src, look, interact]);

  const toggle = () => {
    const ws = wsRef.current;
    if (!ws) return;
    void ws.playPause();
  };

  return { containerRef, ready, playing, current, duration, toggle };
}

export function AudioTile({ id, src, durationSec, className }: { id: string; src: string; durationSec?: number | null; className?: string }) {
  const { containerRef, ready, playing, duration, toggle } = useWave(src, "tile", false);
  const length = duration || durationSec || 0;
  return (
    <div
      data-audio-tile={id}
      className={cn("relative flex size-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-primary/25 via-surface-2 to-surface-3 px-4", className)}
    >
      <div className="relative w-full">
        <div ref={containerRef} className={cn("w-full transition-opacity", ready ? "opacity-100" : "opacity-0")} />
        {!ready && <div className="absolute inset-0 grid place-items-center text-white/40"><SpeakerHigh className="size-6" /></div>}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          disabled={!ready}
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-white/90 text-black shadow transition-transform hover:scale-105 disabled:opacity-40"
        >
          {playing ? <Pause weight="fill" className="size-4" /> : <Play weight="fill" className="size-4 translate-x-px" />}
        </button>
        <span className="text-xs tabular-nums text-white/80">{formatClip(length)}</span>
      </div>
    </div>
  );
}

export function AudioPlayer({ id, src, durationSec }: { id: string; src: string; durationSec?: number | null }) {
  const { containerRef, ready, playing, current, duration, toggle } = useWave(src, "player", true);
  const length = duration || durationSec || 0;
  return (
    <div data-audio-player={id} className="w-full rounded-xl bg-surface-2 p-5">
      <div className="relative">
        <div ref={containerRef} className={cn("w-full transition-opacity", ready ? "opacity-100" : "opacity-0")} />
        {!ready && <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Loading…</div>}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          disabled={!ready}
          onClick={toggle}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-black transition-transform hover:scale-105 disabled:opacity-40"
        >
          {playing ? <Pause weight="fill" className="size-5" /> : <Play weight="fill" className="size-5 translate-x-px" />}
        </button>
        <span className="text-sm tabular-nums text-muted-foreground">{formatClip(current)} / {formatClip(length)}</span>
        {/* The browser's own element for download and keyboard control; hidden visually, not from assistive tech. */}
        <audio src={src} controls preload="none" className="sr-only" />
      </div>
    </div>
  );
}
