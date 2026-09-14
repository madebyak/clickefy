"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BrandLogo } from "@/components/site/brand-logo";
import { List, MagnifyingGlass } from "@phosphor-icons/react";
import { CreditMenu } from "@/components/site/credit-menu";
import { ProfileMenu } from "@/components/site/profile-menu";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { StudioNavigation } from "@/components/studio/studio-navigation";
import { CommandPalette } from "@/components/studio/command-palette";

export function StudioTopbar({ onMenu }: { onMenu: () => void }) {
  const t = useTranslations("nav");
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘K / Ctrl+K from anywhere in the studio.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-2 bg-surface-1 px-2 sm:gap-3 sm:px-4">
      {/* left */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={onMenu}
          aria-label={t("openMenu")}
          aria-haspopup="dialog"
          className="grid size-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-3 lg:hidden"
        >
          <List className="size-5" />
        </button>
        <Link href="/" aria-label={t("home")} className="shrink-0">
          <span className="hidden sm:block"><BrandLogo height={24} eager /></span>
          {/* The brand mark keeps room for the mobile controls. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-mark.svg" alt="" width={28} height={28} className="sm:hidden" />
        </Link>
      </div>

      <StudioNavigation className="hidden min-w-0 items-center gap-1 xl:flex" />

      {/* right */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label={t("search")}
          aria-haspopup="dialog"
          className="flex h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-3"
        >
          <MagnifyingGlass className="size-4" />
          <span className="hidden 2xl:inline">{t("search")}</span>
          <kbd className="hidden rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium lg:inline">
            ⌘K
          </kbd>
        </button>
        <div className="hidden sm:block"><LanguageSwitcher /></div>
        <CreditMenu />
        <ProfileMenu />
      </div>

      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
    </header>
  );
}
