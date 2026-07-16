"use client";

import { useTranslations } from "next-intl";
import { Lightning, Plus, ArrowUpRight } from "@phosphor-icons/react";
import { Menu } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CreditMenu({
  balance = 240,
  subscription = 200,
  topup = 40,
}: {
  balance?: number;
  subscription?: number;
  topup?: number;
}) {
  const t = useTranslations("account");
  return (
    <Menu
      align="end"
      panelClassName="w-72"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            open && "bg-surface-3",
          )}
        >
          <Lightning weight="fill" className="size-4 text-primary" />
          <span className="tabular-nums">{balance}</span>
        </button>
      )}
    >
      {({ close }) => (
        <div className="p-1">
          <div className="px-2 pb-3 pt-1">
            <p className="text-xs text-muted-foreground">{t("availableCredits")}</p>
            <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold tabular-nums">
              <Lightning weight="fill" className="size-5 text-primary" />
              {balance}
            </p>
          </div>
          <div className="space-y-1.5 rounded-lg bg-surface-2 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("subscription")}</span>
              <span className="tabular-nums">{subscription}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("topup")}</span>
              <span className="tabular-nums">{topup}</span>
            </div>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            <Button size="sm" className="w-full" onClick={close}>
              <Plus className="size-4" /> {t("buyCredits")}
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-between" onClick={close}>
              {t("upgradePlan")} <ArrowUpRight className="size-4 rtl:-scale-x-100" />
            </Button>
          </div>
        </div>
      )}
    </Menu>
  );
}
