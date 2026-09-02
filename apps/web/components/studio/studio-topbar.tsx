"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { List, MagnifyingGlass } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { CreditMenu } from "@/components/site/credit-menu";
import { ProfileMenu } from "@/components/site/profile-menu";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { useStudio } from "@/components/studio/studio-context";
import { useToolsMaybe } from "@/components/tools/tools-context";

// `tool` entries open a modal instead of navigating — the tools are
// popups over whatever project is open, not pages of their own.
const NAV = [
  { key: "createImage", href: "/create" },
  { key: "createVideo", href: "/create-video" },
  { key: "storyboard", tool: "storyboard" },
  { key: "cameraAngles", tool: "camera" },
  { key: "templates", href: "/templates" },
] as const;

export function StudioTopbar({ onMenu }: { onMenu: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { setActiveProject } = useStudio();
  const tools = useToolsMaybe();
  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-3 bg-surface-1 px-3 sm:px-4">
      {/* left */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMenu}
          aria-label={t("openMenu")}
          className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-3 lg:hidden"
        >
          <List className="size-5" />
        </button>
        <Link href="/" aria-label={t("home")} className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-withsymbol.svg" alt="Clickefy" className="h-6 w-auto" />
        </Link>
      </div>

      {/* center nav */}
      <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex">
        {NAV.map((n) =>
          "tool" in n ? (
            <button
              key={n.key}
              type="button"
              onClick={() =>
                n.tool === "camera" ? tools?.openCameraAngle() : tools?.openStoryboard()
              }
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(n.key)}
            </button>
          ) : (
            <Link
              key={n.key}
              href={n.href}
              onClick={() => {
                // Entering a studio surface starts fresh on the empty project state.
                if (n.key === "createImage" || n.key === "createVideo") setActiveProject(null);
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                pathname === n.href
                  ? "bg-surface-3 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(n.key)}
            </Link>
          ),
        )}
      </nav>

      {/* right */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="hidden h-9 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-3 md:flex"
        >
          <MagnifyingGlass className="size-4" />
          <span className="hidden lg:inline">{t("search")}</span>
        </button>
        <LanguageSwitcher />
        <CreditMenu />
        <ProfileMenu />
      </div>
    </header>
  );
}
