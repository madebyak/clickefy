"use client";

import { useState } from "react";
import Link from "next/link";
import { List, X } from "@phosphor-icons/react";
import { buttonVariants } from "@/components/ui/button";
import { CreditMenu } from "./credit-menu";
import { ProfileMenu } from "./profile-menu";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { label: "Create Image", href: "/create" },
  { label: "Create Video", href: "/create-video" },
  { label: "Storyboard", href: "#" },
  { label: "Cinema Studio", href: "#" },
  { label: "AI UGC", href: "#" },
  { label: "Templates", href: "/#templates" },
  { label: "Pricing", href: "/#pricing" },
];

export function Navbar({ authed = false }: { authed?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-4 px-4 sm:px-6">
        {/* logo */}
        <Link href="/" className="shrink-0" aria-label="Clickefy home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-withsymbol.svg" alt="Clickefy" className="h-7 w-auto" />
        </Link>

        {/* desktop nav */}
        <nav className="ms-2 hidden items-center xl:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* right actions */}
        <div className="ms-auto flex items-center gap-2">
          {authed ? (
            <>
              <CreditMenu />
              <ProfileMenu />
            </>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link href="#" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Log in
              </Link>
              <Link href="#" className={buttonVariants({ size: "sm" })}>
                Sign up
              </Link>
            </div>
          )}

          {/* mobile toggle */}
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
            className="grid size-9 place-items-center rounded-lg text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary xl:hidden"
          >
            {mobileOpen ? <X className="size-5" /> : <List className="size-5" />}
          </button>
        </div>
      </div>

      {/* mobile menu */}
      {mobileOpen && (
        <div className="border-t border-border bg-background xl:hidden">
          <nav className="mx-auto flex max-w-[90rem] flex-col gap-0.5 px-4 py-3 sm:px-6">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-2"
              >
                {l.label}
              </Link>
            ))}
            {!authed && (
              <div className="mt-3 flex flex-col gap-2 sm:hidden">
                <Link href="#" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                  Log in
                </Link>
                <Link href="#" className={cn(buttonVariants(), "w-full")}>
                  Sign up
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
