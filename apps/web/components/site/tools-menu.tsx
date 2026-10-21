"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowsOutSimple,
  CaretDown,
  FilmStrip,
  Sparkle,
  VideoCamera,
  type Icon,
} from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import { Menu } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

/**
 * The studio's tools, in one place. Both headers (the marketing site and
 * the studio top bar) used to spell the four of them out as flat links,
 * which is where the navigation ran out of room. Here they sit under one
 * "Tools" entry: a mega menu on wide screens, a labelled group in the
 * drawers.
 *
 * The site links deep-link into the studio (`?tool=` is read by
 * ToolDeepLink); the studio opens the modal directly via `onSelect`.
 */
export type ToolKey = "ad" | "storyboard" | "camera" | "upscale";

export const TOOL_ITEMS: ReadonlyArray<{
  key: ToolKey;
  labelKey: string;
  subKey: string;
  href: string;
  icon: Icon;
  /** Ad Magic is the one we are pushing right now. */
  featured?: boolean;
}> = [
  { key: "ad", labelKey: "adMagic", subKey: "adMagicSub", href: "/create?tool=ad", icon: Sparkle, featured: true },
  { key: "storyboard", labelKey: "storyboard", subKey: "storyboardSub", href: "/create?tool=storyboard", icon: FilmStrip },
  { key: "camera", labelKey: "cameraAngles", subKey: "cameraAnglesSub", href: "/create?tool=camera", icon: VideoCamera },
  { key: "upscale", labelKey: "upscaleVideo", subKey: "upscaleVideoSub", href: "/create?tool=upscale", icon: ArrowsOutSimple },
];

function ToolCard({
  item,
  onSelect,
  className,
}: {
  item: (typeof TOOL_ITEMS)[number];
  onSelect?: (key: ToolKey) => void;
  className?: string;
}) {
  const t = useTranslations("nav");
  const Icon = item.icon;
  const inner = (
    <>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          item.featured ? "bg-brand-green/15 text-brand-green" : "bg-surface-2 text-foreground",
        )}
      >
        <Icon className="size-5" weight={item.featured ? "fill" : "regular"} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {t(item.labelKey)}
          {item.featured && (
            <span className="rounded bg-brand-green px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-black">
              {t("new")}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{t(item.subKey)}</span>
      </span>
    </>
  );
  const cls = cn(
    "flex w-full items-start gap-3 rounded-xl p-3 text-start transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
    className,
  );
  return onSelect ? (
    <button type="button" onClick={() => onSelect(item.key)} className={cls}>
      {inner}
    </button>
  ) : (
    <Link href={item.href} className={cls}>
      {inner}
    </Link>
  );
}

/** The "Tools ▾" entry with its two-column mega menu. */
export function ToolsMenu({
  onSelect,
  triggerClassName,
}: {
  /** Studio: open the tool's modal in place instead of navigating. */
  onSelect?: (key: ToolKey) => void;
  triggerClassName?: string;
}) {
  const t = useTranslations("nav");
  return (
    <Menu
      align="start"
      panelClassName="w-[min(34rem,calc(100vw-2rem))] p-2"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          className={cn(
            "inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm transition-colors hover:text-foreground",
            open ? "bg-surface-2 text-foreground" : "text-muted-foreground",
            triggerClassName,
          )}
        >
          {t("tools")}
          <CaretDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      )}
    >
      {({ close }) => (
        <div className="grid gap-1 sm:grid-cols-2">
          {TOOL_ITEMS.map((item) => (
            <ToolCard
              key={item.key}
              item={item}
              onSelect={
                onSelect
                  ? (key) => {
                      close();
                      onSelect(key);
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </Menu>
  );
}

/** The same four, as a labelled group for the mobile drawers. */
export function ToolsList({
  onSelect,
  onNavigate,
  itemClassName,
  children,
}: {
  onSelect?: (key: ToolKey) => void;
  /** Called on any pick — the drawers close themselves with it. */
  onNavigate?: () => void;
  itemClassName?: string;
  /** Rendered before the group label, e.g. the links that precede it. */
  children?: ReactNode;
}) {
  const t = useTranslations("nav");
  return (
    <>
      {children}
      <p className="mt-2 px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("tools")}</p>
      {TOOL_ITEMS.map((item) => (
        <ToolCard
          key={item.key}
          item={item}
          className={cn("p-2.5", itemClassName)}
          onSelect={
            onSelect
              ? (key) => {
                  onNavigate?.();
                  onSelect(key);
                }
              : undefined
          }
        />
      ))}
    </>
  );
}
