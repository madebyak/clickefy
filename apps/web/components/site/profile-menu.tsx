"use client";

import { useTranslations } from "next-intl";
import { GearSix, Images, CreditCard, Question, SignOut } from "@phosphor-icons/react";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-foreground",
        className,
      )}
    >
      {initials}
    </span>
  );
}

export function ProfileMenu({
  name = "Ahmed Kamal",
  email = "ahmed@clickefy.ai",
  plan = "Pro",
}: {
  name?: string;
  email?: string;
  plan?: string;
}) {
  const t = useTranslations("account");
  return (
    <Menu
      align="end"
      panelClassName="w-64"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={t("accountMenu")}
          className="rounded-full outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar name={name} />
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar name={name} className="size-9" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          <div className="px-2 pb-1">
            <span className="inline-flex rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
              {t("planLabel", { plan })}
            </span>
          </div>
          <MenuSeparator />
          <MenuItem onClick={close}>
            <Images className="size-4 text-muted-foreground" /> {t("myProjects")}
          </MenuItem>
          <MenuItem onClick={close}>
            <CreditCard className="size-4 text-muted-foreground" /> {t("billing")}
          </MenuItem>
          <MenuItem onClick={close}>
            <GearSix className="size-4 text-muted-foreground" /> {t("settings")}
          </MenuItem>
          <MenuItem onClick={close}>
            <Question className="size-4 text-muted-foreground" /> {t("help")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={close} className="text-status-red hover:bg-status-red/10">
            <SignOut className="size-4 rtl:-scale-x-100" /> {t("signOut")}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
