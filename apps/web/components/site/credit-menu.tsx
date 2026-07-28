"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Lightning, LockSimple, Plus, ArrowUpRight } from "@phosphor-icons/react";
import { Menu } from "@/components/ui/menu";
import { buttonVariants } from "@/components/ui/button";
import { useCredits } from "@/lib/use-credits";
import { useSession } from "@/lib/use-session";
import { cn } from "@/lib/utils";

export function CreditMenu() {
  const t = useTranslations("account");
  const { user } = useSession();
  const creditsQuery = useCredits();

  // The /me row already carries the total, so the trigger can render
  // before the bucket breakdown arrives.
  const balance = creditsQuery.data?.total ?? user?.creditsBalance;
  const buckets = creditsQuery.data?.buckets;
  const topupSpendable = creditsQuery.data?.topupSpendable ?? true;

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
          {balance === undefined ? (
            <span aria-hidden className="h-3.5 w-7 animate-pulse rounded bg-surface-3" />
          ) : (
            <span className="tabular-nums">{balance}</span>
          )}
        </button>
      )}
    >
      {({ close }) => (
        <div className="p-1">
          <div className="px-2 pb-3 pt-1">
            <p className="text-xs text-muted-foreground">{t("availableCredits")}</p>
            <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold tabular-nums">
              <Lightning weight="fill" className="size-5 text-primary" />
              {balance ?? "—"}
            </p>
          </div>
          <div className="space-y-1.5 rounded-lg bg-surface-2 p-3 text-sm">
            {buckets && buckets.promo > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("promo")}</span>
                <span className="tabular-nums">{buckets.promo}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("subscription")}</span>
              <span className="tabular-nums">{buckets?.subscription ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                {t("topup")}
                {!topupSpendable && (
                  <LockSimple className="size-3.5" aria-label={t("topupLocked")} />
                )}
              </span>
              <span className={cn("tabular-nums", !topupSpendable && "text-muted-foreground")}>
                {buckets?.topup ?? "—"}
              </span>
            </div>
          </div>
          {/* Web billing (Stripe) is a later phase — until then both CTAs
              land on the marketing pricing section. */}
          <div className="mt-2 flex flex-col gap-1.5">
            <Link
              href="/#pricing"
              onClick={close}
              className={cn(buttonVariants({ size: "sm" }), "w-full")}
            >
              <Plus className="size-4" /> {t("buyCredits")}
            </Link>
            <Link
              href="/#pricing"
              onClick={close}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full justify-between")}
            >
              {t("upgradePlan")} <ArrowUpRight className="size-4 rtl:-scale-x-100" />
            </Link>
          </div>
        </div>
      )}
    </Menu>
  );
}
