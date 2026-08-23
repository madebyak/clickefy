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

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, CircleNotch } from "@phosphor-icons/react";

import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ME_QUERY_KEY, useSession } from "@/lib/use-session";
import { PLANS_QUERY_KEY } from "@/lib/use-plans";

/** How long to wait for the webhook before saying so plainly. */
const MAX_WAIT_MS = 25_000;

export default function BillingSuccessPage() {
  const t = useTranslations("pricing");
  const queryClient = useQueryClient();
  const { plan } = useSession();
  const [gaveUp, setGaveUp] = useState(false);

  const confirmed = plan?.tier != null && plan.tier !== "Free";

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
  );
}
