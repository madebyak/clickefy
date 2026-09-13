"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { PromptBar } from "@/components/generate/prompt-bar";

/* ------------------------------------------------------------------ assets */
/**
 * The hero cycles these rather than showing one still, so the card
 * advertises range without asking the visitor to click anything.
 *
 * Order is deliberate: bright and dark frames alternate, so each crossfade
 * reads as a change of scene rather than a dissolve between lookalikes.
 * Frame one is also the LCP image, hence the wide establishing shot.
 *
 * (hero-4 is in the folder but unused — 736x535 against 1672x941 for these,
 * and it duplicates hero-2's subject at a fraction of the sharpness.)
 */
const HERO_IMAGES = [
  "/assets/new/hero-1.png", // bright · coastal, two figures
  "/assets/new/hero-3.png", // dark   · storm sky, magenta
  "/assets/new/hero-2.png", // bright · wildflower hill
  "/assets/new/hero-6.png", // dark   · lotus garden, dusk
  "/assets/new/hero-7.png", // bright · sea rocks, rust + blue
  "/assets/new/hero-5.png", // dusk   · sunset, horse
];
const CREATE_VIDEO = "/assets/Veo-video2.mp4";
const PRODUCT_VIDEO = "/assets/129a6607-51c0-4231-9cd9-1c4d05a400d2.mp4";

/* ------------------------------------------------------------------ media */

function AutoVideo({ src }: { src?: string }) {
  if (!src) return null;
  return (
    <video
      className="absolute inset-0 size-full object-cover"
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}

/** How long each hero frame holds before the crossfade to the next. */
const SLIDE_MS = 5000;

function HeroSlideshow({ images }: { images: string[] }) {
  const [index, setIndex] = useState(0);
  /**
   * High-water mark of how many slides are in the DOM. Six full-bleed
   * photographs fetched on first paint is several megabytes before the
   * visitor has seen the second one, so slides mount as they come up. It
   * only ever grows, so wrapping back to the first slide does not unmount
   * what the browser already has.
   */
  const [mounted, setMounted] = useState(2);

  useEffect(() => {
    if (images.length < 2) return;
    // A hero that changes on its own is exactly the unrequested movement
    // "reduce motion" asks us to stop, so those visitors keep frame one.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % images.length), SLIDE_MS);
    return () => clearInterval(id);
  }, [images.length]);

  useEffect(() => {
    setMounted((n) => Math.max(n, Math.min(images.length, index + 2)));
  }, [index, images.length]);

  return (
    <div className="absolute inset-0">
      {images.slice(0, mounted).map((src, i) => (
        <Image
          key={src}
          src={src}
          alt=""
          fill
          sizes="(min-width: 1024px) 58vw, 100vw"
          // Frame one is the LCP element. `priority` is deprecated in Next 16;
          // the docs point at this pair instead.
          loading={i === 0 ? "eager" : "lazy"}
          fetchPriority={i === 0 ? "high" : "auto"}
          className={cn(
            "object-cover transition-opacity duration-1000 ease-in-out motion-reduce:transition-none",
            i === index ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
    </div>
  );
}

/**
 * Flat wash over the whole card. Cheap legibility for the small cards,
 * where the copy sits directly on moving footage.
 */
const SCRIM_FULL = "bg-gradient-to-t from-black/85 via-black/25 to-black/40";

/**
 * The hero's scrim instead darkens only the two bands the text occupies and
 * passes through clean in between, so the photograph keeps its own contrast
 * and colour where you actually look at it.
 */
const SCRIM_EDGES =
  "bg-[linear-gradient(to_bottom,rgba(0,0,0,0.62)_0%,rgba(0,0,0,0.22)_26%,transparent_44%,transparent_56%,rgba(0,0,0,0.42)_82%,rgba(0,0,0,0.72)_100%)]";

function MediaCard({
  videoSrc,
  media,
  tint,
  scrim = SCRIM_FULL,
  className,
  children,
}: {
  videoSrc?: string;
  /** Replaces the looping video — used by the hero's crossfade. */
  media?: React.ReactNode;
  tint?: string;
  scrim?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-surface-2", className)}>
      {tint ? <div className={cn("absolute inset-0", tint)} /> : null}
      {media ?? <AutoVideo src={videoSrc} />}
      <div className={cn("absolute inset-0", scrim)} />
      <div className="relative z-10 flex h-full flex-col">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------- tool cards */

/**
 * Both of these deep-link into the studio the same way the navbar and
 * footer do — `ToolDeepLink` reads `?tool=` on /create and opens the
 * modal. They used to be inert divs advertising a tool you could not
 * reach from them.
 */
function ToolCard({
  href,
  title,
  sub,
  children,
}: {
  href: string;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[200px] flex-col overflow-hidden rounded-2xl border border-transparent bg-surface-2 p-6 transition-colors hover:border-border hover:bg-surface-3"
    >
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
      <div className="mt-4 grid flex-1 place-items-center">{children}</div>
    </Link>
  );
}

/**
 * Six panels of a shot sheet, framed wide → medium → close and back.
 *
 * Drawn rather than photographed on purpose: the storyboard tool emits ONE
 * image of consistently-styled panels, so a strip of six unrelated stills
 * would describe a product we do not sell. The sample frames in
 * `public/tools/storyboard` are the same cottage in five styles — a style
 * picker, not a sequence — so they would read as a bug here.
 */
const PANEL_W = 48;
const PANEL_H = 34;

/**
 * Head radius and body box per panel, so the figure reads as a person
 * framed at a distance rather than a bar of a chart. Wide → medium →
 * close and back out again.
 */
const SHOTS = [
  { head: 1.5, bw: 4, bh: 5 },
  { head: 2.8, bw: 7.5, bh: 10 },
  { head: 5, bw: 13, bh: 17 },
  { head: 5, bw: 13, bh: 17 },
  { head: 2.8, bw: 7.5, bh: 10 },
  { head: 1.5, bw: 4, bh: 5 },
];

function StoryboardSheet() {
  return (
    <svg
      viewBox="0 0 156 76"
      className="w-full max-w-[11rem]"
      role="img"
      aria-hidden="true"
      fill="none"
    >
      {SHOTS.map((s, i) => {
        const x = (i % 3) * 54;
        const y = Math.floor(i / 3) * 42;
        const cx = x + PANEL_W / 2;
        const ground = y + PANEL_H - 7;
        // One green panel rather than six: the sheet stays calm, and the
        // card still carries the brand accent the others have. It sits on
        // the close-up because the accent is wasted on a figure six pixels
        // tall.
        const figure = i === 2 ? "fill-brand-green opacity-80" : "fill-foreground opacity-28";
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={PANEL_W}
              height={PANEL_H}
              rx={3}
              className="fill-surface-1 stroke-border"
              strokeWidth={1}
            />
            <line
              x1={x + 4}
              x2={x + PANEL_W - 4}
              y1={ground}
              y2={ground}
              className="stroke-border"
              strokeWidth={1}
            />
            <circle cx={cx} cy={ground - s.bh - s.head} r={s.head} className={figure} />
            <rect
              x={cx - s.bw / 2}
              y={ground - s.bh}
              width={s.bw}
              height={s.bh}
              rx={s.bw / 2.6}
              className={figure}
            />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A wireframe sphere with the camera parked off the equator — the same
 * figure the camera-angle tool draws, at a glance. Kept to degrees on two
 * axes because that is genuinely the whole control surface: the product
 * has no named shot types, and the tool prompt was tuned that way on
 * purpose ("named shot types overshoot").
 */
const ORBIT_R = 30;
const ORBIT_RY = 10; // the equator seen in perspective
/** Where the camera sits, matching the readout below. */
const PUCK = { h: 35, v: 18 };

function OrbitDial() {
  const t = (PUCK.h * Math.PI) / 180;
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <svg viewBox="0 0 120 76" className="w-full max-w-[9rem]" role="img" aria-hidden="true" fill="none">
        <g className="stroke-accent-turquoise" strokeWidth={1}>
          {/* silhouette + longitude cage */}
          <circle cx={60} cy={38} r={ORBIT_R} opacity={0.32} />
          <ellipse cx={60} cy={38} rx={20} ry={ORBIT_R} opacity={0.2} strokeDasharray="2 3" />
          <ellipse cx={60} cy={38} rx={8} ry={ORBIT_R} opacity={0.2} strokeDasharray="2 3" />
          {/* equator, then the ±40° latitudes */}
          <ellipse cx={60} cy={38} rx={ORBIT_R} ry={ORBIT_RY} opacity={0.6} />
          <ellipse cx={60} cy={19} rx={23} ry={7.6} opacity={0.2} strokeDasharray="2 3" />
          <ellipse cx={60} cy={57} rx={23} ry={7.6} opacity={0.2} strokeDasharray="2 3" />
        </g>
        {/* the photo, on the plane at the sphere's centre */}
        <rect
          x={48}
          y={31}
          width={24}
          height={15}
          rx={2}
          className="fill-surface-3 stroke-accent-turquoise"
          strokeWidth={1}
          strokeOpacity={0.45}
        />
        {/* the camera, and the line it is sighting down */}
        <line
          x1={60}
          y1={38}
          x2={60 + ORBIT_R * Math.cos(t)}
          y2={38 + ORBIT_RY * Math.sin(t) - PUCK.v * 0.42}
          className="stroke-brand-green"
          strokeWidth={1}
          strokeOpacity={0.4}
          strokeDasharray="2 2"
        />
        <circle
          cx={60 + ORBIT_R * Math.cos(t)}
          cy={38 + ORBIT_RY * Math.sin(t) - PUCK.v * 0.42}
          r={3.5}
          className="fill-brand-green"
        />
      </svg>
      {/* Degrees are physical, not text — pinned LTR like the tool's stage. */}
      <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">
        H {PUCK.h}° · V {PUCK.v}°
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- section */

export function HomeHero() {
  const t = useTranslations("home");

  return (
    <section className="mx-auto w-full max-w-site site-px">
      <div className="grid gap-4 lg:grid-cols-12">
        {/* ---- hero (left, big) ---- */}
        <MediaCard
          media={<HeroSlideshow images={HERO_IMAGES} />}
          scrim={SCRIM_EDGES}
          className="min-h-[520px] lg:col-span-7 lg:min-h-[42rem]"
        >
          <div className="flex h-full flex-col p-6 sm:p-8">
            <p className="font-mono text-xs uppercase tracking-widest text-brand-green">
              {t("heroEyebrow")}
            </p>
            <h2 className="mt-4 max-w-[13ch] text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl xl:text-6xl">
              {t("heroHeadline")}
            </h2>
            <p className="mt-3 text-white/80">{t("heroSub")}</p>

            <div className="flex-1" />

            {/* Same composer as the studio, one size down — see PromptBar's
                `size` prop for why this is a variant rather than a fork. */}
            <PromptBar size="compact" animatedPlaceholder />
          </div>
        </MediaCard>

        {/* ---- right column ---- */}
        <div className="flex flex-col gap-4 lg:col-span-5">
          {/* create video */}
          <MediaCard
            videoSrc={CREATE_VIDEO}
            tint="bg-[radial-gradient(120%_120%_at_80%_0%,rgba(219,0,120,0.28),transparent_60%)]"
            className="min-h-[220px]"
          >
            <div className="relative flex h-full flex-col p-6">
              <span className="absolute end-4 top-4 rounded-md bg-brand-green px-2 py-0.5 text-[11px] font-semibold text-black">
                {t("new")}
              </span>
              <h3 className="text-2xl font-semibold tracking-tight">{t("createVideo")}</h3>
              <p className="mt-1 text-white/70">{t("createVideoSub")}</p>
              <div className="flex-1" />
              <Link
                href="/create-video"
                className="inline-flex w-fit items-center gap-2 rounded-lg bg-surface-2/80 px-4 py-2 text-sm font-medium backdrop-blur transition-colors hover:bg-surface-3"
              >
                {t("exploreVideoTemplates")} <ArrowRight className="size-4 rtl:-scale-x-100" />
              </Link>
            </div>
          </MediaCard>

          {/* storyboard + camera angles */}
          <div className="grid gap-4 sm:grid-cols-2">
            <ToolCard
              href="/create?tool=storyboard"
              title={t("storyboard")}
              sub={t("storyboardSub")}
            >
              <StoryboardSheet />
            </ToolCard>

            <ToolCard
              href="/create?tool=camera"
              title={t("cameraAngles")}
              sub={t("cameraAnglesSub")}
            >
              <OrbitDial />
            </ToolCard>
          </div>

          {/* product visuals */}
          <MediaCard
            videoSrc={PRODUCT_VIDEO}
            tint="bg-[radial-gradient(120%_120%_at_70%_0%,rgba(99,3,224,0.26),transparent_60%)]"
            className="min-h-[170px]"
          >
            <div className="relative flex h-full flex-col p-6">
              <Link
                href="#"
                aria-label={t("openProductVisuals")}
                className="absolute end-4 top-4 grid size-9 place-items-center rounded-lg bg-surface-2/70 backdrop-blur transition-colors hover:bg-surface-3"
              >
                <ArrowUpRight className="size-4 rtl:-scale-x-100" />
              </Link>
              <h3 className="max-w-[9rem] text-2xl font-semibold leading-tight tracking-tight">
                {t("productVisuals")}
              </h3>
              <p className="mt-1 text-sm text-white/70">{t("productVisualsSub")}</p>
            </div>
          </MediaCard>
        </div>
      </div>
    </section>
  );
}
