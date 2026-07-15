"use client";

import Link from "next/link";
import { List, MagnifyingGlass } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { CreditMenu } from "@/components/site/credit-menu";
import { ProfileMenu } from "@/components/site/profile-menu";

const NAV = [
  { label: "Create Image", href: "/create" },
  { label: "Create Video", href: "#" },
  { label: "Storyboard", href: "#" },
  { label: "Camera Angles", href: "#" },
  { label: "Templates", href: "/#templates" },
];

export function StudioTopbar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-3 bg-surface-1 px-3 sm:px-4">
      {/* left */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open menu"
          className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-3 lg:hidden"
        >
          <List className="size-5" />
        </button>
        <Link href="/" aria-label="Clickefy home" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-withsymbol.svg" alt="Clickefy" className="h-6 w-auto" />
        </Link>
      </div>

      {/* center nav */}
      <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex">
        {NAV.map((n, i) => (
          <Link
            key={n.label}
            href={n.href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              i === 0
                ? "bg-surface-3 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      {/* right */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="hidden h-9 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-3 md:flex"
        >
          <MagnifyingGlass className="size-4" />
          <span className="hidden lg:inline">Search anything…</span>
        </button>
        <CreditMenu balance={3450} subscription={3200} topup={250} />
        <ProfileMenu name="Ahmed Kamal" email="ahmed@clickefy.ai" plan="Pro" />
      </div>
    </header>
  );
}
