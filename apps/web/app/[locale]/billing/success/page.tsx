"use client";

/**
 * Where Stripe returns a customer after a successful checkout.
 *
 * The payment is already done by the time anyone lands here — Stripe took
 * it — but the CREDITS arrive via the `invoice.paid` webhook, which is a
 * separate round trip. That is normally a second or two, and it is the
 * one moment a customer is most anxious, so this page waits for the
 * credits to actually appear rather than claiming success and leaving
 * them to discover an unchanged balance.
 *
 * It polls `/v1/users/me` until the entitlement stops being `free`. If the
 * webhook is delayed we say so honestly instead of spinning forever —
 * their payment is safe either way, and Stripe retries for three days.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, CircleNotch } from "@phosphor-icons/react";

import { Link } from "@/i18n/navigation";
import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ME_QUERY_KEY, useSession } from "@/lib/use-session";
import { PLANS_QUERY_KEY, usePlans } from "@/lib/use-plans";

/** How long to wait for the webhook before saying so plainly. */
const MAX_WAIT_MS = 25_000;

function BillingSuccessContent() {
  const t = useTranslations("pricing");
  const queryClient = useQueryClient();
  const { plan, user } = useSession();
  const { data: catalogue } = usePlans();
  const purchasedPlanId = useSearchParams().get("plan");
  const [gaveUp, setGaveUp] = useState(false);

  // What we are waiting for. Checkout carries the plan id back, so we can
  // wait for THAT tier rather than merely "no longer free".
  //
  // This matters most for an UPGRADE. Someone moving Basic → Creator is
  // already non-free the instant they land here, so a "not free" check
  // would declare success immediately and show them their OLD tier and
  // OLD credit balance — wrong information at the one moment they have
  // just spent money and are looking closely.
  const expectedTier = purchasedPlanId
    ? catalogue?.plans.find((p) => p.id === purchasedPlanId)?.tier
    : undefined;

  const confirmed = expectedTier
    ? user?.entitlement === expectedTier
    : // No plan id (someone opened this page directly) — fall back to the
      // weaker check, which is still right for a first-time subscriber.
      user != null && plan.entitlement !== "free";

  useEffect(() => {
    if (confirmed) return;
    // Re-read the user until the grant lands. React Query's cache is what
    // the topbar credit widget reads too, so invalidating here updates the
    // whole app the moment credits arrive.
    const poll = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: PLANS_QUERY_KEY });
    }, 2_000);
    const bail = setTimeout(() => setGaveUp(true), MAX_WAIT_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(bail);
    };
  }, [confirmed, queryClient]);

  return (
    // Same per-page Navbar/Footer pattern as every other public page.
    // Without them this was a bare card on an empty page — at the exact
    // moment someone has just paid and wants to get into the product.
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar />
      <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      {confirmed ? (
        <>
          <CheckCircle weight="fill" className="size-14 text-primary" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">{t("successTitle")}</h1>
          <p className="mt-2 text-muted-foreground">{t("successBody")}</p>
          <p className="mt-4 text-sm font-medium">
            {plan.tier} · {plan.credits.toLocaleString()} credits
          </p>
          <Link href="/create" className={cn(buttonVariants({ variant: "primary" }), "mt-7")}>
            {t("successCta")}
          </Link>
        </>
      ) : (
        <>
          <CircleNotch className={cn("size-10 text-muted-foreground", !gaveUp && "animate-spin")} />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">
            {gaveUp ? t("successTitle") : t("successPending")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {gaveUp ? t("successBody") : t("successPendingBody")}
          </p>
          {gaveUp && (
            <Link href="/create" className={cn(buttonVariants({ variant: "primary" }), "mt-7")}>
              {t("successCta")}
            </Link>
          )}
        </>
      )}
      </main>
      <Footer />
    </div>
  );
}

/**
 * `useSearchParams` suspends during prerender, and a static page that
 * calls it without a boundary FAILS THE PRODUCTION BUILD — while working
 * perfectly in dev, where routes render on demand. Hence the explicit
 * boundary, with the same spinner the pending state uses so the hand-off
 * is invisible.
 */
export default function BillingSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6">
          <CircleNotch className="size-10 animate-spin text-muted-foreground" />
        </main>
      }
    >
      <BillingSuccessContent />
    </Suspense>
  );
}
