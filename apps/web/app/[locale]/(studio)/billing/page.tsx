"use client";

/**
 * Billing — the page that answers "what am I paying, what do I have, and
 * how do I stop".
 *
 * Until now those answers lived in three places: a cramped block on
 * Settings, Stripe's hosted portal, and the pricing page. Someone trying
 * to cancel had to leave the product to do it, which is both a worse
 * experience and a worse signal — we never learned why.
 *
 * Everything here reads from `GET /v1/billing/subscription`, which reads
 * from STRIPE rather than our own columns: a plan cancelled in the portal
 * five seconds ago must not still show as active here.
 */

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowSquareOut,
  CreditCard,
  DownloadSimple,
  Lightning,
  LockSimple,
  Receipt,
  Warning,
} from "@phosphor-icons/react";

import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { CancelDialog } from "@/components/billing/cancel-dialog";
import { useSession } from "@/lib/use-session";
import { useCredits } from "@/lib/use-credits";
import { useBillingActions } from "@/lib/use-billing-actions";
import { useInvoices, useSubscription, useSubscriptionActions } from "@/lib/use-subscription";
import { cn } from "@/lib/utils";

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-surface-2 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function BillingPage() {
  const t = useTranslations("billing");
  const ta = useTranslations("account");
  const tp = useTranslations("pricing");
  const locale = useLocale();

  const { user, plan } = useSession();
  const creditsQuery = useCredits();
  const subQuery = useSubscription();
  const { openPortal, portalPending } = useBillingActions();
  const { cancel, resume } = useSubscriptionActions();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const sub = subQuery.data?.subscription ?? null;
  const invoicesQuery = useInvoices(!!subQuery.data?.platform);
  const invoices = invoicesQuery.data ?? [];

  const date = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) : null;
  const money = (cents: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

  if (!user) {
    return (
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="h-8 w-32 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-44 animate-pulse rounded-2xl bg-surface-2" />
          <div className="h-32 animate-pulse rounded-2xl bg-surface-2" />
        </div>
      </main>
    );
  }

  const buckets = creditsQuery.data?.buckets;
  const isStripe = subQuery.data?.platform === "stripe";
  const isStore = subQuery.data?.platform === "app_store" || subQuery.data?.platform === "play_store";
  // A paid tier with no platform behind it: granted by an admin, not sold.
  const isComped = plan.entitlement !== "free" && !subQuery.data?.platform;

  const onCancel = async (input: { reason?: string; comment?: string }) => {
    try {
      const res = await cancel.mutateAsync(input);
      setConfirmingCancel(false);
      toast.success(res.accessUntil ? t("cancelledUntil", { date: date(res.accessUntil)! }) : t("cancelled"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("actionFailed"));
    }
  };

  const onResume = async () => {
    try {
      await resume.mutateAsync();
      toast.success(t("resumed"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("actionFailed"));
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4 pb-16">
        <h1 className="text-xl font-semibold">{t("title")}</h1>

        {/* ── Plan ─────────────────────────────────────────────── */}
        <Section title={t("planSection")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-md bg-primary/15 px-2 py-0.5 text-sm font-medium text-primary">
                  {ta("planLabel", { plan: plan.tier })}
                </span>
                {sub?.interval && (
                  <span className="text-xs text-muted-foreground">
                    {sub.interval === "year" ? t("billedYearly") : t("billedMonthly")}
                  </span>
                )}
                {sub && sub.status !== "active" && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-status-red/15 px-2 py-0.5 text-xs font-medium text-status-red">
                    <Warning className="size-3.5" />
                    {t(`status_${sub.status}` as never)}
                  </span>
                )}
              </div>

              {/* One line that says what happens next, whatever that is. */}
              <p className="mt-2 text-xs text-muted-foreground">
                {subQuery.isLoading
                  ? t("loading")
                  : sub?.cancelAtPeriodEnd
                    ? t("endsOn", { date: date(sub.currentPeriodEnd) ?? "—" })
                    : sub?.pendingChange
                      ? t("pendingChange", {
                          tier: sub.pendingChange.tier ?? "",
                          date: date(sub.pendingChange.effectiveAt) ?? "—",
                        })
                      : sub?.currentPeriodEnd
                        ? t("renewsOn", { date: date(sub.currentPeriodEnd)! })
                        : isComped
                          ? t("compedUntil", { date: date(subQuery.data?.expiresAt) ?? "—" })
                          : t("noPlan")}
              </p>
            </div>

            <p className="flex items-center gap-1.5 text-2xl font-semibold tabular-nums">
              <Lightning weight="fill" className="size-5 text-primary" />
              {creditsQuery.data?.total ?? user.creditsBalance}
            </p>
          </div>

          {/* Credit breakdown */}
          {buckets && (
            <div className="mt-4 space-y-1.5 rounded-lg bg-surface-1 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{ta("subscription")}</span>
                <span className="tabular-nums">{buckets.subscription}</span>
              </div>
              {buckets.promo > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{ta("promo")}</span>
                  <span className="tabular-nums">{buckets.promo}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  {ta("topup")}
                  {!creditsQuery.data?.topupSpendable && <LockSimple className="size-3.5" />}
                </span>
                <span className="tabular-nums">{buckets.topup}</span>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/pricing"
              className={cn(buttonVariants({ variant: "primary", size: "sm" }))}
            >
              {sub ? t("changePlan") : t("choosePlan")}
            </Link>

            {sub?.cancelAtPeriodEnd || sub?.pendingChange ? (
              <Button size="sm" variant="outline" disabled={resume.isPending} onClick={() => void onResume()}>
                {resume.isPending ? t("resuming") : t("resume")}
              </Button>
            ) : sub ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-status-red"
                onClick={() => setConfirmingCancel(true)}
              >
                {t("cancelPlan")}
              </Button>
            ) : null}
          </div>

          {isStore && (
            <p className="mt-3 rounded-lg bg-surface-1 p-3 text-xs text-muted-foreground">
              {tp("manageInApp")}
            </p>
          )}
          {isComped && (
            <p className="mt-3 rounded-lg bg-surface-1 p-3 text-xs text-muted-foreground">
              {t("compedNote")}
            </p>
          )}
        </Section>

        {/* ── Payment method ───────────────────────────────────── */}
        {isStripe && (
          <Section title={t("paymentSection")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {subQuery.data?.paymentMethod ? (
                <p className="flex items-center gap-2 text-sm">
                  <CreditCard className="size-5 text-muted-foreground" />
                  <span className="capitalize">{subQuery.data.paymentMethod.brand}</span>
                  <span className="text-muted-foreground">•••• {subQuery.data.paymentMethod.last4}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("cardExpires", {
                      month: String(subQuery.data.paymentMethod.expMonth).padStart(2, "0"),
                      year: String(subQuery.data.paymentMethod.expYear).slice(-2),
                    })}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("noCard")}</p>
              )}
              <button
                type="button"
                onClick={() => void openPortal()}
                disabled={portalPending}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  portalPending && "pointer-events-none opacity-60",
                )}
              >
                {portalPending ? tp("starting") : t("updateCard")}
                <ArrowSquareOut className="size-4 rtl:-scale-x-100" />
              </button>
            </div>
          </Section>
        )}

        {/* ── Invoices ─────────────────────────────────────────── */}
        {isStripe && (
          <Section title={t("invoicesSection")}>
            {invoicesQuery.isLoading ? (
              <div className="h-16 animate-pulse rounded-lg bg-surface-1" />
            ) : invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noInvoices")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {date(inv.createdAt)}
                        {inv.number && <span className="ms-2 text-xs text-muted-foreground">{inv.number}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {money(inv.amountPaid || inv.amountDue, inv.currency)} ·{" "}
                        {t(`invoiceStatus_${inv.status}` as never)}
                      </p>
                    </div>
                    {inv.pdfUrl && (
                      <a
                        href={inv.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0")}
                        aria-label={t("downloadInvoice")}
                      >
                        <DownloadSimple className="size-4" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {/* ── Top-ups ──────────────────────────────────────────── */}
        <Section title={t("topupSection")}>
          <p className="text-sm text-muted-foreground">
            {plan.entitlement === "free" ? t("topupNeedsPlan") : t("topupBlurb")}
          </p>
          <Link
            href="/pricing#topup"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}
          >
            <Receipt className="size-4" />
            {t("buyCredits")}
          </Link>
        </Section>
      </div>

      {confirmingCancel && (
        <CancelDialog
          accessUntil={date(sub?.currentPeriodEnd)}
          pending={cancel.isPending}
          onConfirm={(input) => void onCancel(input)}
          onClose={() => setConfirmingCancel(false)}
        />
      )}
    </main>
  );
}
