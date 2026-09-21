"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useStudio } from "@/components/studio/studio-context";
import { useToolsMaybe } from "@/components/tools/tools-context";
import { cn } from "@/lib/utils";

const NAV = [
  { key: "createImage", href: "/create" },
  { key: "createVideo", href: "/create-video" },
  { key: "storyboard", tool: "storyboard" },
  { key: "cameraAngles", tool: "camera" },
  { key: "upscaleVideo", tool: "upscale" },
  { key: "templates", href: "/templates" },
] as const;

export function StudioNavigation({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { setActiveProject } = useStudio();
  const tools = useToolsMaybe();
  return (
    <nav className={className}>
      {NAV.map((item) => {
        const itemClass = "rounded-lg px-3 py-2.5 text-start text-sm whitespace-nowrap transition-colors hover:bg-surface-2 hover:text-foreground";
        return "tool" in item ? (
          <button key={item.key} type="button" className={cn(itemClass, "text-muted-foreground")}
            onClick={() => {
              onNavigate?.();
              if (item.tool === "camera") tools?.openCameraAngle();
              else if (item.tool === "upscale") tools?.openUpscale();
              else tools?.openStoryboard();
            }}>
            {t(item.key)}
          </button>
        ) : (
          <Link key={item.key} href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
            className={cn(itemClass, pathname === item.href ? "bg-surface-3 text-foreground" : "text-muted-foreground")}
            onClick={() => {
              if (item.key === "createImage" || item.key === "createVideo") setActiveProject(null);
              onNavigate?.();
            }}>
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
