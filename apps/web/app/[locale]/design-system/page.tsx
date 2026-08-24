"use client";

import { useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Sparkle,
  Image as ImageIcon,
  VideoCamera,
  FilmSlate,
  PaintBrush,
  MagicWand,
  DownloadSimple,
  Heart,
  User,
  Gear,
  MagnifyingGlass,
  Plus,
  SlidersHorizontal,
  Lightning,
  Palette,
  Cube,
  Play,
  Star,
  Trash,
  PencilSimple,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { PromptBar } from "@/components/generate/prompt-bar";
import {
  CanvasToolbar,
  DEFAULT_GRID_SIZE,
  type CanvasFilter,
  type GridSize,
} from "@/components/studio/canvas-toolbar";
import { DrawModal } from "@/components/generate/draw-modal";
import { Masonry } from "@/components/studio/masonry";
import type { Asset } from "@/components/studio/studio-context";
import { CreditMenu } from "@/components/site/credit-menu";
import { ProfileMenu } from "@/components/site/profile-menu";

/* ----------------------------------------------------------------- helpers */

function copy(value: string, label: string) {
  navigator.clipboard?.writeText(value);
  toast.success(`Copied ${label}`, { description: value });
}

/** A 1x1 transparent GIF — enough for a tile, no network needed. */
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function MasonryTileDemo() {
  const [assets, setAssets] = useState<Asset[]>(() =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `demo-${i}`,
      projectId: "demo",
      type: (i % 3 === 0 ? "video" : "image") as Asset["type"],
      src: PIXEL,
      favorited: i === 1,
      projectName: `Project ${i + 1}`,
    })),
  );
  const [size, setSize] = useState<GridSize>(DEFAULT_GRID_SIZE);
  const [sel, setSel] = useState<string[]>([]);
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-3">
      <div className="mb-3 flex items-center gap-3">
        <span className="me-auto ps-1 text-sm text-muted-foreground">
          Hover a tile: heart + ··· menu. The menu portals out of the clipped tile.
        </span>
        <CanvasToolbar
          filter="all"
          onFilterChange={() => {}}
          gridSize={size}
          onGridSizeChange={setSize}
          counts={{ image: 4, video: 2 }}
        />
      </div>
      <Masonry
        assets={assets}
        gridSize={size}
        showProjectName
        selectedIds={sel}
        onToggleSelect={(id) =>
          setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
        }
        onAssetClick={() => {}}
        onAssetInfo={() => {}}
        onAssetReuse={() => {}}
        onToggleFavorite={(a) =>
          setAssets((p) =>
            p.map((x) => (x.id === a.id ? { ...x, favorited: !x.favorited } : x)),
          )
        }
      />
    </div>
  );
}

function DrawModalDemo() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-3">
      <div className="flex items-center gap-3">
        <span className="me-auto ps-1 text-sm text-muted-foreground">
          Annotate an image, save it as a reference
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center rounded-lg bg-surface-3 px-3 text-sm font-medium"
        >
          Open Draw
        </button>
      </div>
      {saved && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={saved} alt="" className="mt-3 max-h-64 rounded-lg" />
      )}
      <DrawModal
        open={open}
        sources={[]}
        onClose={() => setOpen(false)}
        onSave={(file) => setSaved(URL.createObjectURL(file))}
      />
    </div>
  );
}

function CanvasToolbarDemo() {
  const [filter, setFilter] = useState<CanvasFilter>("all");
  const [gridSize, setGridSize] = useState<GridSize>(DEFAULT_GRID_SIZE);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-3">
      <span className="me-auto ps-1 text-sm text-muted-foreground">Canvas header centre</span>
      <CanvasToolbar
        filter={filter}
        onFilterChange={setFilter}
        gridSize={gridSize}
        onGridSizeChange={setGridSize}
        counts={{ image: 6, video: 3 }}
      />
    </div>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border py-12 lg:py-16">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1.5 max-w-[42rem] text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ colors */

type Swatch = { name: string; token: string; hex: string; cls: string };

const SURFACES: Swatch[] = [
  { name: "Background", token: "--background", hex: "#000000", cls: "bg-background" },
  { name: "Surface 1", token: "--surface-1", hex: "#0A0A0C", cls: "bg-surface-1" },
  { name: "Surface 2", token: "--surface-2", hex: "#131317", cls: "bg-surface-2" },
  { name: "Surface 3", token: "--surface-3", hex: "#1C1C22", cls: "bg-surface-3" },
];
const BRAND: Swatch[] = [
  { name: "Green — Primary", token: "--brand-green", hex: "#42D676", cls: "bg-brand-green" },
  { name: "Purple — Secondary", token: "--brand-purple", hex: "#6303E0", cls: "bg-brand-purple" },
];
const ACCENTS: Swatch[] = [
  { name: "Turquoise", token: "--accent-turquoise", hex: "#00DCAE", cls: "bg-accent-turquoise" },
  { name: "Pink", token: "--accent-pink", hex: "#DB0078", cls: "bg-accent-pink" },
];
const STATUS: Swatch[] = [
  { name: "Red", token: "--status-red", hex: "#EF0744", cls: "bg-status-red" },
  { name: "Green — Status", token: "--status-green", hex: "#07DD44", cls: "bg-status-green" },
];
const TEXT: Swatch[] = [
  { name: "Foreground", token: "--foreground", hex: "#FAFAFA", cls: "bg-foreground" },
  { name: "Muted", token: "--muted-foreground", hex: "#9B9BA4", cls: "bg-muted-foreground" },
];

function SwatchCard({ s }: { s: Swatch }) {
  return (
    <button type="button" onClick={() => copy(s.hex, s.name)} className="group text-left">
      <div
        className={cn(
          "h-24 w-full rounded-lg border border-border transition-transform group-hover:scale-[1.02]",
          s.cls,
        )}
      />
      <div className="mt-2 space-y-0.5">
        <p className="text-sm font-medium">{s.name}</p>
        <p className="font-mono text-xs uppercase text-muted-foreground">{s.hex}</p>
        <p className="font-mono text-[11px] text-muted-foreground/70">{s.token}</p>
      </div>
    </button>
  );
}

function SwatchGrid({ items }: { items: Swatch[] }) {
  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((s) => (
        <SwatchCard key={s.token} s={s} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- scales */

const TYPE_SCALE = [
  { name: "Display", cls: "text-6xl", px: 60, weight: "font-semibold" },
  { name: "H1", cls: "text-4xl", px: 36, weight: "font-semibold" },
  { name: "H2", cls: "text-3xl", px: 30, weight: "font-semibold" },
  { name: "H3", cls: "text-2xl", px: 24, weight: "font-medium" },
  { name: "H4", cls: "text-xl", px: 20, weight: "font-medium" },
  { name: "Large", cls: "text-lg", px: 18, weight: "font-normal" },
  { name: "Body", cls: "text-base", px: 16, weight: "font-normal" },
  { name: "Small", cls: "text-sm", px: 14, weight: "font-normal" },
  { name: "Caption", cls: "text-xs", px: 12, weight: "font-normal" },
];

const WEIGHTS = [
  { name: "Light", cls: "font-light", n: 300 },
  { name: "Regular", cls: "font-normal", n: 400 },
  { name: "Medium", cls: "font-medium", n: 500 },
  { name: "Semibold", cls: "font-semibold", n: 600 },
  { name: "Bold", cls: "font-bold", n: 700 },
];

// token name → Tailwind numeric utility → px
const SPACING = [
  { token: "2xs", util: "1", px: 4 },
  { token: "xs", util: "2", px: 8 },
  { token: "sm", util: "3", px: 12 },
  { token: "md", util: "4", px: 16 },
  { token: "lg", util: "6", px: 24 },
  { token: "xl", util: "8", px: 32 },
  { token: "2xl", util: "12", px: 48 },
  { token: "3xl", util: "16", px: 64 },
  { token: "4xl", util: "24", px: 96 },
];

const BREAKPOINTS = [
  { token: "base", px: "0", target: "Phones (mobile-first default)" },
  { token: "xs", px: "480", target: "Large phones / small foldables" },
  { token: "sm", px: "640", target: "Landscape phones" },
  { token: "md", px: "768", target: "Tablet portrait" },
  { token: "lg", px: "1024", target: "Tablet landscape / small laptop" },
  { token: "xl", px: "1280", target: "Laptop / primary desktop" },
  { token: "2xl", px: "1536", target: "Large desktop" },
  { token: "3xl", px: "1920", target: "Ultrawide / 4K" },
];

const RADIUS = [
  { name: "sm", cls: "rounded-sm", px: "7px" },
  { name: "md", cls: "rounded-md", px: "10px" },
  { name: "lg", cls: "rounded-lg", px: "12px" },
  { name: "xl", cls: "rounded-xl", px: "17px" },
  { name: "2xl", cls: "rounded-2xl", px: "22px" },
];

/* ------------------------------------------------------------------- assets */

function AssetTile({
  src,
  label,
  hint,
  boxClassName,
}: {
  src: string;
  label: string;
  hint: string;
  boxClassName?: string;
}) {
  const [ok, setOk] = useState(true);
  const imgRef = useRef<HTMLImageElement>(null);
  // Catch images that already 404'd during SSR before the onError handler attached.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth === 0) setOk(false);
  }, []);
  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-1",
          boxClassName,
        )}
      >
        {ok ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={src}
            alt={label}
            className="max-h-[60%] max-w-[70%] object-contain"
            onError={() => setOk(false)}
          />
        ) : (
          <div className="px-3 text-center">
            <p className="text-xs font-medium text-muted-foreground">Drop file at</p>
            <p className="font-mono text-[11px] text-muted-foreground/70">{src}</p>
          </div>
        )}
      </div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- icons */

const ICON_SET: { Icon: PhosphorIcon; name: string }[] = [
  { Icon: Sparkle, name: "Sparkle" },
  { Icon: ImageIcon, name: "Image" },
  { Icon: VideoCamera, name: "VideoCamera" },
  { Icon: FilmSlate, name: "FilmSlate" },
  { Icon: PaintBrush, name: "PaintBrush" },
  { Icon: MagicWand, name: "MagicWand" },
  { Icon: Palette, name: "Palette" },
  { Icon: Cube, name: "Cube" },
  { Icon: Lightning, name: "Lightning" },
  { Icon: SlidersHorizontal, name: "Sliders" },
  { Icon: MagnifyingGlass, name: "Search" },
  { Icon: Plus, name: "Plus" },
  { Icon: DownloadSimple, name: "Download" },
  { Icon: Heart, name: "Heart" },
  { Icon: Star, name: "Star" },
  { Icon: Play, name: "Play" },
  { Icon: User, name: "User" },
  { Icon: Gear, name: "Gear" },
  { Icon: PencilSimple, name: "Edit" },
  { Icon: Trash, name: "Trash" },
];

const WEIGHT_ROW = ["thin", "light", "regular", "bold", "fill", "duotone"] as const;

/* --------------------------------------------------------------------- page */

const NAV = [
  ["logo", "Logo"],
  ["favicons", "Favicons"],
  ["colors", "Colors"],
  ["typography", "Typography"],
  ["i18n", "Bilingual"],
  ["spacing", "Spacing"],
  ["breakpoints", "Breakpoints"],
  ["radius", "Radius"],
  ["icons", "Icons"],
  ["components", "Components"],
  ["patterns", "Patterns"],
];

export default function DesignSystemPage() {
  // Internal living style guide — dev-only. 404s on production deploys
  // (NODE_ENV is inlined at build time, so the branch compiles away).
  if (process.env.NODE_ENV === "production") notFound();
  const [dir, setDir] = useState<"ltr" | "rtl">("ltr");
  useEffect(() => {
    document.documentElement.dir = dir;
    return () => {
      document.documentElement.dir = "ltr";
    };
  }, [dir]);
  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-site flex-wrap items-center gap-x-6 gap-y-2 py-4 site-px">
          <div className="mr-auto flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-md bg-brand-green">
              <Sparkle weight="fill" className="size-4 text-black" />
            </div>
            <span className="font-semibold tracking-tight">Clickefy</span>
            <span className="font-mono text-xs text-muted-foreground">/ design-system</span>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="hover:text-foreground">
                {label}
              </a>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setDir((d) => (d === "ltr" ? "rtl" : "ltr"))}
            className="rounded-md border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Toggle text direction"
          >
            {dir.toUpperCase()} ⇄
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-site pb-24 site-px">
        {/* intro */}
        <div className="py-12 lg:py-16">
          <p className="font-mono text-xs uppercase tracking-widest text-brand-green">
            Foundations
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Design System</h1>
          <p className="mt-3 max-w-[42rem] text-muted-foreground">
            The single source of truth for Clickefy Web. Tokens live in{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
              app/globals.css
            </code>
            . Click any color to copy its value. Components are built on these next.
          </p>
        </div>

        {/* logo */}
        <Section
          id="logo"
          title="Logo"
          description="Primary wordmark and symbol. Drop the real assets into public/brand/ and they render here automatically."
        >
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <AssetTile src="/brand/logo.svg" label="Full logo" hint="Wordmark + symbol · SVG" boxClassName="h-40" />
            <AssetTile src="/brand/logo-mark.svg" label="Symbol / mark" hint="Square icon · SVG" boxClassName="h-40" />
            <AssetTile src="/brand/logo-white.svg" label="Monochrome" hint="White version for dark surfaces" boxClassName="h-40" />
          </div>
        </Section>

        {/* favicons */}
        <Section
          id="favicons"
          title="Favicons & App Icons"
          description="Browser and platform icons. Prefer Next's metadata files (app/favicon.ico, app/icon.png, app/apple-icon.png); extras live in public/icons/."
        >
          <div className="flex flex-wrap gap-6">
            <AssetTile src="/icons/favicon.svg" label="favicon.svg" hint="source · vector" boxClassName="size-32" />
            <AssetTile src="/favicon.ico" label="favicon.ico" hint="16/32/48 · legacy" boxClassName="size-32" />
            <AssetTile src="/apple-icon.png" label="apple-icon" hint="180 · iOS" boxClassName="size-32" />
            <AssetTile src="/icons/icon-192.png" label="icon-192" hint="192 · PWA" boxClassName="size-32" />
            <AssetTile src="/icons/icon-512.png" label="icon-512" hint="512 · PWA" boxClassName="size-32" />
            <AssetTile src="/icons/maskable-512.png" label="maskable" hint="512 · Android" boxClassName="size-32" />
          </div>
        </Section>

        {/* colors */}
        <Section
          id="colors"
          title="Colors"
          description="Black-first palette. Full black is the main background; three surface shades build elevation. Brand green drives primary actions; purple, turquoise and pink are brand accents; red and a near-identical green are status \u2014 tell them apart by placement, not hue."
        >
          <div className="space-y-8">
            <div>
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">Backgrounds & Surfaces</h3>
              <SwatchGrid items={SURFACES} />
            </div>
            <div>
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">Brand</h3>
              <SwatchGrid items={BRAND} />
            </div>
            <div>
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">Accents</h3>
              <SwatchGrid items={ACCENTS} />
            </div>
            <div>
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">Status</h3>
              <SwatchGrid items={STATUS} />
            </div>
            <div>
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">Text</h3>
              <SwatchGrid items={TEXT} />
            </div>
          </div>
        </Section>

        {/* typography */}
        <Section
          id="typography"
          title="Typography"
          description="Geist Sans for UI and Geist Mono for code, values and technical labels."
        >
          <div className="mb-8 grid gap-6 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface-1 p-6">
              <p className="font-mono text-xs uppercase text-muted-foreground">Sans · Geist</p>
              <p className="mt-2 text-3xl">Ag</p>
              <p className="mt-2 text-sm text-muted-foreground">
                ABCDEFGHIJKLM abcdefghijklm 0123456789
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface-1 p-6">
              <p className="font-mono text-xs uppercase text-muted-foreground">Mono · Geist Mono</p>
              <p className="mt-2 font-mono text-3xl">Ag</p>
              <p className="mt-2 font-mono text-sm text-muted-foreground">
                ABCDEF abcdef 0123456789 {"{}"} =&gt;
              </p>
            </div>
          </div>

          {/* scale */}
          <div className="space-y-4">
            {TYPE_SCALE.map((t) => (
              <div key={t.name} className="flex items-baseline gap-6 border-b border-border/50 pb-4">
                <div className="w-24 shrink-0">
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{t.px}px</p>
                </div>
                <p className={cn("truncate", t.cls, t.weight)}>Create the impossible</p>
              </div>
            ))}
          </div>

          {/* weights */}
          <div className="mt-8">
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">Weights</h3>
            <div className="flex flex-wrap gap-8">
              {WEIGHTS.map((w) => (
                <div key={w.n}>
                  <p className={cn("text-2xl", w.cls)}>Aa</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {w.name} · {w.n}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* i18n / RTL */}
        <Section
          id="i18n"
          title="Bilingual & RTL (AR / EN)"
          description="The app ships English and Arabic. Arabic uses IBM Plex Sans Arabic and right-to-left layout. Toggle LTR/RTL in the header to preview — components use Tailwind logical properties so they mirror automatically."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div dir="rtl" lang="ar" className="rounded-lg border border-border bg-surface-1 p-6">
              <p dir="ltr" className="font-mono text-xs uppercase text-muted-foreground">
                Arabic · IBM Plex Sans Arabic
              </p>
              <p className="mt-3 text-4xl font-semibold">أنشئ المستحيل</p>
              <p className="mt-2 text-lg">صانع المحتوى الاحترافي بالذكاء الاصطناعي</p>
              <p className="mt-2 text-sm text-muted-foreground">
                أنشئ صورًا ومقاطع فيديو مذهلة باستخدام أحدث النماذج.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface-1 p-6">
              <p className="font-mono text-xs uppercase text-muted-foreground">RTL rules</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>
                  Use logical utilities —{" "}
                  <code className="rounded bg-surface-3 px-1 font-mono text-[11px] text-foreground">
                    ms/me · ps/pe · start/end · text-start
                  </code>{" "}
                  — never <code className="font-mono text-[11px]">ml/mr/left/right</code>.
                </li>
                <li>
                  Mirror directional icons with{" "}
                  <code className="rounded bg-surface-3 px-1 font-mono text-[11px] text-foreground">
                    rtl:-scale-x-100
                  </code>
                  ; never flip logos, checkmarks, avatars or media.
                </li>
                <li>Audit transforms, shadows and any hardcoded left/right — they don&apos;t auto-flip.</li>
                <li>Arabic: line-height ~1.75, no letter-spacing, no all-caps hierarchy.</li>
                <li>Full next-intl <code className="font-mono text-[11px]">/en · /ar</code> routing lands when we build real pages.</li>
              </ul>
            </div>
          </div>
        </Section>

        {/* spacing */}
        <Section
          id="spacing"
          title="Spacing"
          description="4px atomic base, 8px rhythm. Use numeric utilities (p-2 = 8px, gap-6 = 24px). The token names below are the naming convention; the utility column is what you actually write."
        >
          <div className="space-y-3">
            {SPACING.map((s) => (
              <div key={s.token} className="flex items-center gap-6">
                <div className="w-12 shrink-0 font-mono text-xs text-foreground">{s.token}</div>
                <div className="w-16 shrink-0 font-mono text-xs text-brand-green">p-{s.util}</div>
                <div className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{s.px}px</div>
                <div className="h-4 rounded-sm bg-brand-green" style={{ width: `${s.px}px` }} />
              </div>
            ))}
          </div>
        </Section>

        {/* breakpoints */}
        <Section
          id="breakpoints"
          title="Breakpoints"
          description="Mobile-first (min-width). Tailwind v4 defaults plus xs (480) and 3xl (1920). Use container queries for resizable panels; reserve these for the app shell. Cap main content at ~1440px."
        >
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b border-border bg-surface-1 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Token</th>
                  <th className="px-4 py-3 font-medium">Min width</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                </tr>
              </thead>
              <tbody>
                {BREAKPOINTS.map((b) => (
                  <tr key={b.token} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3 font-mono text-brand-green">{b.token}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {b.px === "0" ? "0" : `${b.px}px`}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{b.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* radius */}
        <Section id="radius" title="Radius" description="Corner radius scale, derived from a 0.75rem base.">
          <div className="flex flex-wrap gap-6">
            {RADIUS.map((r) => (
              <div key={r.name} className="text-center">
                <div className={cn("size-20 border border-border bg-surface-2", r.cls)} />
                <p className="mt-2 text-sm font-medium">{r.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{r.px}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* icons */}
        <Section
          id="icons"
          title="Icons"
          description="Phosphor Icons (@phosphor-icons/react) — six weights. Matches the mobile app's icon language."
        >
          {/* weights */}
          <div className="mb-8">
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">Weights</h3>
            <div className="flex flex-wrap gap-8">
              {WEIGHT_ROW.map((w) => (
                <div key={w} className="text-center">
                  <MagicWand weight={w} className="size-8 text-brand-green" />
                  <p className="mt-2 font-mono text-xs capitalize text-muted-foreground">{w}</p>
                </div>
              ))}
            </div>
          </div>

          {/* grid */}
          <div>
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">Sample set</h3>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-10">
              {ICON_SET.map(({ Icon, name }) => (
                <div
                  key={name}
                  className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface-1 p-4"
                >
                  <Icon weight="regular" className="size-6" />
                  <span className="truncate text-[11px] text-muted-foreground">{name}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* components */}
        <Section
          id="components"
          title="Components"
          description="Core UI built on the tokens above — themed, accessible, and RTL-safe via logical properties. More land here as we build the studio."
        >
          <div className="space-y-10">
            <div>
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">Button</h3>
              <div className="flex flex-wrap items-center gap-3">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
                <Button size="icon" aria-label="Add">
                  <Plus className="size-5" />
                </Button>
                <Button>
                  <Sparkle weight="fill" className="size-4" /> Generate
                </Button>
                <Button disabled>Disabled</Button>
              </div>
            </div>

            <div>
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">Badge</h3>
              <div className="flex flex-wrap items-center gap-3">
                <Badge>Default</Badge>
                <Badge variant="green">Green</Badge>
                <Badge variant="purple">Purple</Badge>
                <Badge variant="turquoise">Turquoise</Badge>
                <Badge variant="pink">Pink</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="danger">Danger</Badge>
              </div>
            </div>

            <div>
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">Input & Textarea</h3>
              <div className="grid max-w-[42rem] gap-4 sm:grid-cols-2">
                <Input placeholder="Enter a prompt…" />
                <Input placeholder="Disabled" disabled />
                <Textarea placeholder="Describe what you want to create…" className="sm:col-span-2" />
              </div>
            </div>

            <div>
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">Switch & Checkbox</h3>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                <label className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Switch defaultChecked aria-label="On" /> On
                </label>
                <label className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Switch aria-label="Off" /> Off
                </label>
                <label className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Switch disabled aria-label="Disabled" /> Disabled
                </label>
                <label className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Checkbox defaultChecked aria-label="Checked" /> Checked
                </label>
                <label className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Checkbox aria-label="Unchecked" /> Unchecked
                </label>
              </div>
            </div>
          </div>
        </Section>

        {/* patterns */}
        <Section
          id="patterns"
          title="Patterns"
          description="Composed, product-level components built from the primitives above. First up: the image Generate bar — model, aspect ratio, quality, count, Draw, and live credit cost."
        >
          <PromptBar />

          <div className="mt-10">
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">
              Account menus (navbar, logged-in)
            </h3>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-1 p-3">
              <span className="me-auto ps-1 text-sm text-muted-foreground">Navbar right side</span>
              <CreditMenu />
              <ProfileMenu />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Click the credit pill or avatar to open. Logged-out shows Log in / Sign up instead.
            </p>
          </div>

          <div className="mt-10">
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">
              Studio canvas toolbar
            </h3>
            <CanvasToolbarDemo />
          </div>

          <div className="mt-10">
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">Draw modal</h3>
            <DrawModalDemo />
          </div>

          <div className="mt-10">
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">Asset tiles</h3>
            <MasonryTileDemo />
            <p className="mt-2 text-xs text-muted-foreground">
              Type filter and grid density, as they appear in the /create header. The
              type filter is hidden unless the project holds both images and videos.
            </p>
          </div>
        </Section>
      </main>
    </div>
  );
}
