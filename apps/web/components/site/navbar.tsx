"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { List, X } from "@phosphor-icons/react";
import { buttonVariants } from "@/components/ui/button";
import { CreditMenu } from "./credit-menu";
import { ProfileMenu } from "./profile-menu";
import { LanguageSwitcher } from "./language-switcher";
import { ToolsList, ToolsMenu } from "./tools-menu";
import { cn } from "@/lib/utils";
import { BrandLogo } from "./brand-logo";

// The four studio tools live under one "Tools" entry (see tools-menu);
// the rest stay flat. Order is left to right on the bar.
const PRIMARY_LINKS = [
  { key: "createImage", href: "/create" },
  { key: "createVideo", href: "/create-video" },
  { key: "audio", href: "/audio" },
] as const;
const SECONDARY_LINKS = [
  { key: "templates", href: "/templates" },
  { key: "pricing", href: "/pricing" },
] as const;

const linkClass = "rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground";
const mobileLinkClass = "rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-2";

export function Navbar() {
  const t = useTranslations("nav");
  const [mobileOpen, setMobileOpen] = useState(false);
  // Until Clerk hydrates, render the signed-out header (no layout shift
  // worse than a brief button swap for returning users).
  const { isLoaded, isSignedIn } = useAuth();
  const authed = isLoaded && !!isSignedIn;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-site items-center gap-4 site-px">
        <Link href="/" className="shrink-0" aria-label={t("home")}>
          <BrandLogo eager />
        </Link>

        <nav className="ms-2 hidden items-center lg:flex">
          {PRIMARY_LINKS.map((l) => (
            <Link key={l.key} href={l.href} className={linkClass}>
              {t(l.key)}
            </Link>
          ))}
          <ToolsMenu />
          {SECONDARY_LINKS.map((l) => (
            <Link key={l.key} href={l.href} className={linkClass}>
              {t(l.key)}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <LanguageSwitcher />
          {authed ? (
            <>
              <CreditMenu />
              <ProfileMenu />
            </>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link href="/sign-in" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                {t("login")}
              </Link>
              <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>
                {t("signup")}
              </Link>
            </div>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={t("toggleMenu")}
            aria-expanded={mobileOpen}
            className="grid size-9 place-items-center rounded-lg text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
          >
            {mobileOpen ? <X className="size-5" /> : <List className="size-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-background lg:hidden">
          <nav className="mx-auto flex w-full max-w-site flex-col gap-0.5 py-3 site-px">
            <ToolsList onNavigate={() => setMobileOpen(false)}>
              {PRIMARY_LINKS.map((l) => (
                <Link key={l.key} href={l.href} onClick={() => setMobileOpen(false)} className={mobileLinkClass}>
                  {t(l.key)}
                </Link>
              ))}
            </ToolsList>
            <div className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2">
              {SECONDARY_LINKS.map((l) => (
                <Link key={l.key} href={l.href} onClick={() => setMobileOpen(false)} className={mobileLinkClass}>
                  {t(l.key)}
                </Link>
              ))}
            </div>
            {!authed && (
              <div className="mt-3 flex flex-col gap-2 sm:hidden">
                <Link href="/sign-in" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                  {t("login")}
                </Link>
                <Link href="/sign-up" className={cn(buttonVariants(), "w-full")}>
                  {t("signup")}
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
