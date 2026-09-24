"use client";

/**
 * The sentence before a plan change.
 *
 * An upgrade charges the FULL new price the moment it is confirmed and
 * restarts the billing cycle from today; a downgrade is booked for the
 * end of the paid period and changes nothing until then. Both used to
 * happen on a single click of a plan card, with the amount and the date
 * surfacing afterwards as a toast — the wrong order for anything that
 * moves money. This says what will happen, in the customer's own
 * numbers, and waits.
 *
 * The rules it states are the founder's (2026-09-23): full price, keep
 * every credit, renewal date becomes today; downgrade at the period end
 * with the smaller allowance from then on.
 */

import { useLocale, useTranslations } from "next-intl";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type { CataloguePlan } from "@/lib/use-plans";
import { useSubscription } from "@/lib/use-subscription";

export function PlanChangeDialog({
  plan,
  direction,
  pending,
  onConfirm,
  onClose,
}: {
  plan: CataloguePlan;
  direction: "upgrade" | "downgrade";
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("billing");
  const tp = useTranslations("pricing");
  const locale = useLocale();
  const subQuery = useSubscription();

  const planName = tp(`${plan.tier}Name`);
  const priceUsd = plan.prices.stripe ?? null;
  const price =
    priceUsd == null
      ? "—"
      : new Intl.NumberFormat(locale, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: Number.isInteger(priceUsd) ? 0 : 2,
        }).format(priceUsd);
  const credits = plan.creditsPerPeriod.toLocaleString(locale);
  const fmt = (d: Date | null) =>
    d ? d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) : null;

  // An upgrade renews one period from TODAY; a downgrade lands at the end
  // of the period already paid for.
  const renewsAt = (() => {
    const d = new Date();
    if (plan.interval === "year") d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
    return d;
  })();
  const periodEnd = subQuery.data?.subscription?.currentPeriodEnd
    ? new Date(subQuery.data.subscription.currentPeriodEnd)
    : null;

  const isUpgrade = direction === "upgrade";
  const title = isUpgrade
    ? t("confirmUpgradeTitle", { plan: planName })
    : t("confirmDowngradeTitle", { plan: planName });
  const body = isUpgrade
    ? t("confirmUpgradeBody", { price, credits, date: fmt(renewsAt) ?? "" })
    : periodEnd
      ? t("confirmDowngradeBody", { price, credits, date: fmt(periodEnd) ?? "" })
      : t("confirmDowngradeBodyNoDate", { price, credits });

  return (
    <Modal onClose={onClose} label={title} className="w-[min(28rem,calc(100vw-2rem))]">
      <div className="p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("notNow")}
          </Button>
          <Button variant={isUpgrade ? "primary" : "outline"} onClick={onConfirm} disabled={pending}>
            {pending
              ? t("changing")
              : isUpgrade
                ? t("confirmUpgradeCta", { price })
                : t("confirmDowngradeCta")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
