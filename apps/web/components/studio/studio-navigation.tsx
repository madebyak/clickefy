"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useStudio } from "@/components/studio/studio-context";
import { useToolsMaybe } from "@/components/tools/tools-context";
import { ToolsList, ToolsMenu, type ToolKey } from "@/components/site/tools-menu";
import { cn } from "@/lib/utils";

const LINKS = [
  { key: "createImage", href: "/create" },
  { key: "createVideo", href: "/create-video" },
  { key: "audio", href: "/audio" },
] as const;
const TRAILING = [{ key: "templates", href: "/templates" }] as const;

/**
 * The studio's own navigation. `bar` is the top bar on wide screens
 * (the tools fold into a mega menu); `list` is the sidebar drawer on
 * narrower ones, where the same tools sit as a labelled group.
 */
export function StudioNavigation({
  className,
  layout = "bar",
  onNavigate,
}: {
  className?: string;
  layout?: "bar" | "list";
  onNavigate?: () => void;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { setActiveProject } = useStudio();
  const tools = useToolsMaybe();

  const openTool = (key: ToolKey) => {
    if (key === "ad") tools?.openAd();
    else if (key === "camera") tools?.openCameraAngle();
    else if (key === "upscale") tools?.openUpscale();
    else tools?.openStoryboard();
  };

  const itemClass =
    "rounded-lg px-3 py-2.5 text-start text-sm whitespace-nowrap transition-colors hover:bg-surface-2 hover:text-foreground";
  const link = (item: { key: string; href: string }) => (
    <Link
      key={item.key}
      href={item.href}
      aria-current={pathname === item.href ? "page" : undefined}
      className={cn(itemClass, pathname === item.href ? "bg-surface-3 text-foreground" : "text-muted-foreground")}
      onClick={() => {
        if (item.key === "createImage" || item.key === "createVideo" || item.key === "audio") setActiveProject(null);
        onNavigate?.();
      }}
    >
      {t(item.key)}
    </Link>
  );

  if (layout === "list") {
    return (
      <nav className={className}>
        <ToolsList onSelect={openTool} onNavigate={onNavigate}>
          {LINKS.map(link)}
        </ToolsList>
        <div className="mt-2 border-t border-border pt-2">{TRAILING.map(link)}</div>
      </nav>
    );
  }
  return (
    <nav className={className}>
      {LINKS.map(link)}
      <ToolsMenu
        onSelect={(key) => {
          onNavigate?.();
          openTool(key);
        }}
        triggerClassName="py-2.5"
      />
      {TRAILING.map(link)}
    </nav>
  );
}
