"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowRight, ArrowUpRight, VideoCamera } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { PromptBar } from "@/components/generate/prompt-bar";

/* ------------------------------------------------------------------ assets */
const HERO_VIDEO = "/assets/Kling-Images-2.mp4";
const CREATE_VIDEO = "/assets/Veo-video2.mp4";
const PRODUCT_VIDEO = "/assets/129a6607-51c0-4231-9cd9-1c4d05a400d2.mp4";
const STORYBOARD = [
  "/assets/9c80f14bd51b051bb029053c71e3bbb3.jpg",
  "/assets/21a4d7e76d86558a6c1b63db2982edbd.jpg",
  "/assets/16654be06b68b715118b40c4a9c2f7ff.jpg",
];

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

function MediaCard({
  videoSrc,
  tint,
  className,
  children,
}: {
  videoSrc?: string;
  tint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-surface-2", className)}>
      <div className={cn("absolute inset-0", tint)} />
      <AutoVideo src={videoSrc} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/40" />
      <div className="relative z-10 flex h-full flex-col">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- section */

export function HomeHero() {
  const t = useTranslations("home");

  return (
    <section className="mx-auto max-w-[90rem] px-4 sm:px-6">
      <div className="grid gap-4 lg:grid-cols-12">
        {/* ---- hero (left, big) ---- */}
        <MediaCard
          videoSrc={HERO_VIDEO}
          tint="bg-[radial-gradient(120%_120%_at_15%_0%,rgba(99,3,224,0.30),transparent_60%)]"
          className="min-h-[520px] lg:col-span-7 lg:min-h-[42rem]"
        >
          <div className="flex h-full flex-col p-6 sm:p-8">
            <p className="font-mono text-xs uppercase tracking-widest text-brand-yellow">
              {t("imageStudio")}
            </p>
            <h2 className="mt-4 max-w-lg text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl xl:text-6xl">
              {t("heroHeadline")}
            </h2>
            <p className="mt-3 text-white/70">{t("heroSub")}</p>

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
              <span className="absolute end-4 top-4 rounded-md bg-brand-yellow px-2 py-0.5 text-[11px] font-semibold text-black">
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
            <div className="flex min-h-[200px] flex-col rounded-2xl bg-surface-2 p-6">
              <h3 className="text-lg font-semibold">{t("storyboard")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t("storyboardSub")}</p>
              <div className="flex-1" />
              <div>
                <div className="flex gap-2">
                  {STORYBOARD.map((src, i) => (
                    <div key={i} className="aspect-square flex-1 overflow-hidden rounded-lg bg-surface-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="size-full object-cover" />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center text-[11px] text-muted-foreground">
                  <span>1</span>
                  <div className="mx-2 h-px flex-1 bg-border" />
                  <span>2</span>
                  <div className="mx-2 h-px flex-1 bg-border" />
                  <span>3</span>
                </div>
              </div>
            </div>

            <div className="flex min-h-[200px] flex-col overflow-hidden rounded-2xl bg-surface-2 p-6">
              <h3 className="text-lg font-semibold">{t("cameraAngles")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t("cameraAnglesSub")}</p>
              <div className="relative mt-4 flex-1 rounded-lg bg-surface-3/40">
                <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(var(--color-border)_1px,transparent_1px),linear-gradient(90deg,var(--color-border)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
                <div className="absolute inset-0 grid place-items-center">
                  <VideoCamera className="size-6 text-muted-foreground" />
                </div>
              </div>
            </div>
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
