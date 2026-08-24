"use client";

/**
 * Starting a checkout, and opening the Stripe Customer Portal.
 *
 * Both are server-driven redirects: our API creates the session and hands
 * back a URL we send the browser to. The publishable key never has to
 * touch this — Stripe hosts the payment page, so no card details pass
 * through our code at any point.
 */

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { config } from "@/lib/config";

/** Error codes the API returns that deserve their own message. */
type BillingErrorCode =
  | "subscribed_elsewhere"
  | "plan_not_purchasable"
  | "stripe_unconfigured"
  | "no_stripe_customer"
  | "topup_requires_subscription"
  | "pack_not_purchasable";

async function post<T>(
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: T; error?: { code?: string; message?: string } }
    | null;
  if (!res.ok || !json?.data) {
    return {
      ok: false,
      code: json?.error?.code ?? `http_${res.status}`,
      message: json?.error?.message ?? "Something went wrong.",
    };
  }
  return { ok: true, data: json.data };
}

export function useBillingActions() {
  const { getToken, isSignedIn } = useAuth();
  const t = useTranslations("pricing");
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [pendingPackId, setPendingPackId] = useState<string | null>(null);
  const [portalPending, setPortalPending] = useState(false);

  /**
   * Send the user to Stripe Checkout for one plan.
   *
   * A signed-out visitor is sent to sign-up first with the plan carried in
   * the URL, so they land back on a checkout for the plan they actually
   * picked rather than an empty pricing page.
   */
  async function startCheckout(planId: string) {
    if (!isSignedIn) {
      window.location.href = `/sign-up?redirect_url=${encodeURIComponent(
        `/?plan=${planId}#pricing`,
      )}`;
      return;
    }
    setPendingPlanId(planId);
    try {
      const token = await getToken();
      const result = await post<{ url: string }>("/v1/billing/checkout", token, {
        planId,
        // Carry the plan through the round trip. The success page has to
        // know WHICH plan to wait for: an upgrade lands on a user who is
        // already subscribed, so "are they still on the free tier" cannot
        // tell whether the new plan has arrived yet.
        successPath: `/billing/success?plan=${encodeURIComponent(planId)}`,
        cancelPath: "/#pricing",
      });
      if (!result.ok) {
        // The one case worth its own copy: they already pay through a
        // store, and sending them to Stripe would bill them twice.
        toast.error(
          result.code === ("subscribed_elsewhere" satisfies BillingErrorCode)
            ? t("manageInApp")
            : result.message,
        );
        return;
      }
      // Full navigation, not a router push — the destination is Stripe.
      window.location.href = result.data.url;
    } catch {
      toast.error(t("checkoutFailed"));
    } finally {
      setPendingPlanId(null);
    }
  }

  /**
   * Buy a credit pack — a ONE-TIME payment, not a subscription.
   *
   * Deliberately hits `/v1/billing/topup` rather than `/checkout`: that
   * endpoint uses `mode: 'payment'`, and sending a pack through the
   * subscription endpoint would enrol the customer in a monthly charge
   * for what they believed was a single top-up.
   */
  async function startTopup(packId: string) {
    if (!isSignedIn) {
      window.location.href = `/sign-up?redirect_url=${encodeURIComponent("/pricing")}`;
      return;
    }
    setPendingPackId(packId);
    try {
      const token = await getToken();
      const result = await post<{ url: string }>("/v1/billing/topup", token, {
        packId,
        successPath: "/billing/success?topup=1",
        cancelPath: "/pricing",
      });
      if (!result.ok) {
        // The one case with its own copy: they have no plan, so the
        // credits would be unspendable even once bought.
        toast.error(
          result.code === ("topup_requires_subscription" satisfies BillingErrorCode)
            ? t("topupNeedsPlan")
            : result.message,
        );
        return;
      }
      window.location.href = result.data.url;
    } catch {
      toast.error(t("checkoutFailed"));
    } finally {
      setPendingPackId(null);
    }
  }

  /** Open the Stripe Customer Portal: cancel, change plan, update card. */
  async function openPortal() {
    setPortalPending(true);
    try {
      const token = await getToken();
      const result = await post<{ url: string }>("/v1/billing/portal", token);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      window.location.href = result.data.url;
    } catch {
      toast.error(t("checkoutFailed"));
    } finally {
      setPortalPending(false);
    }
  }

  return {
    startCheckout,
    startTopup,
    openPortal,
    pendingPlanId,
    pendingPackId,
    portalPending,
  };
}
