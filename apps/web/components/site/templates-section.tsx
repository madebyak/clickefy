"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Image as ImageIcon,
  Images,
  FilmSlate,
  VideoCamera,
  ArrowRight,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type TemplateType = "image" | "image-set" | "image-video" | "video";

const TYPE_META: Record<TemplateType, { label: string; Icon: Icon }> = {
  image: { label: "Image", Icon: ImageIcon },
  "image-set": { label: "Image set", Icon: Images },
  "image-video": { label: "Image + Video", Icon: FilmSlate },
  video: { label: "Video", Icon: VideoCamera },
};

const CATEGORIES = ["All", "Fashion", "Beauty", "Portrait", "Product", "Cinematic", "Interior"];

type Template = {
  title: string;
  category: string;
  type: TemplateType;
  img: string;
  /** When set, the card previews as an auto-looping video (img is the poster). */
  video?: string;
};

const TEMPLATES: Template[] = [
  { title: "Puffer Editorial", category: "Fashion", type: "image", img: "/assets/21a4d7e76d86558a6c1b63db2982edbd.jpg" },
  { title: "Glass Skin", category: "Beauty", type: "image-set", img: "/assets/9c80f14bd51b051bb029053c71e3bbb3.jpg" },
  { title: "Studio Portrait", category: "Portrait", type: "image", img: "/assets/0f8dad5a57467f8788f0e6be98924c2e.jpg" },
  { title: "Product Hero", category: "Product", type: "image-video", img: "/assets/16654be06b68b715118b40c4a9c2f7ff.jpg", video: "/assets/129a6607-51c0-4231-9cd9-1c4d05a400d2.mp4" },
  { title: "Neon Nights", category: "Cinematic", type: "video", img: "/assets/987ac62f95b7292782498f28bea6e2e5.jpg", video: "/assets/975be97a-9951-4b13-8164-7669d9e62c62.mp4" },
  { title: "Runway Look", category: "Fashion", type: "image-set", img: "/assets/1853e30e65039bdaca0f3b5d5a927a31.jpg" },
  { title: "Golden Hour", category: "Portrait", type: "image", img: "/assets/19d64ae180f986f329e0427901e0a3b6.jpg" },
  { title: "Serum Campaign", category: "Product", type: "image", img: "/assets/44f6c9193c5fbad553a39365e643d325.jpg" },
  { title: "Cozy Interior", category: "Interior", type: "image", img: "/assets/4a3759d212ca16933c5a0ef7d424b46e.jpg" },
  { title: "Street Style", category: "Fashion", type: "image-video", img: "/assets/66c2bc99b2707c10686fdeaf0af29a0b.jpg", video: "/assets/8a479299-2b06-40df-8b58-ca62fff20480.mp4" },
  { title: "Soft Glam", category: "Beauty", type: "image", img: "/assets/9679583672ad21cc7486dbf5bf221444.jpg" },
  { title: "Cinematic Drive", category: "Cinematic", type: "video", img: "/assets/1ded17351c618f995413d16f71061a4e.jpg", video: "/assets/522455bf-ff1f-41c5-a048-a9f40b06763c.mp4" },
  { title: "Minimal Loft", category: "Interior", type: "image", img: "/assets/16ea40729954d9f7955c0aa18b5311a7.jpg" },
  { title: "Editorial Beauty", category: "Beauty", type: "image-set", img: "/assets/425321aaa07c0244454cdab421f9dcf2-2.jpg" },
  { title: "Lookbook", category: "Fashion", type: "image", img: "/assets/9dc49668408f711f0a052b89dcdba229.jpg" },
];

function TemplateCard({ t }: { t: Template }) {
  const meta = TYPE_META[t.type];
  return (
    <Link href="#" className="group block overflow-hidden rounded-xl bg-surface-2">
      <div className="relative aspect-[3/4] overflow-hidden bg-surface-3">
        {t.video ? (
          <video
            className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            poster={t.img}
          >
            <source src={t.video} type="video/mp4" />
          </video>
        ) : (
          <Image
            src={t.img}
            alt={t.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}
        <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-1 text-[11px] font-medium text-white backdrop-blur">
          <meta.Icon weight="fill" className="size-3.5" />
          {meta.label}
        </span>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium">{t.title}</p>
        <p className="truncate text-xs text-muted-foreground">{t.category}</p>
      </div>
    </Link>
  );
}

export function TemplatesSection() {
  const [cat, setCat] = useState("All");
  const shown = cat === "All" ? TEMPLATES : TEMPLATES.filter((t) => t.category === cat);

  return (
    <section className="mx-auto mt-16 max-w-[90rem] px-4 sm:px-6">
      {/* header row */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Templates</h2>
          <p className="mt-1 text-sm text-muted-foreground">Start from a proven recipe.</p>
        </div>
        <Link
          href="#"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          View all templates <ArrowRight className="size-4" />
        </Link>
      </div>

      {/* categories */}
      <div className="mt-6">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          All categories
        </p>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={cn(
                "shrink-0 rounded-full px-4 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                cat === c
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* grid */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {shown.map((t) => (
          <TemplateCard key={t.title} t={t} />
        ))}
      </div>
    </section>
  );
}
