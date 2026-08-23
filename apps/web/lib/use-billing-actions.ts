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
  | "no_stripe_customer";

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
        successPath: "/billing/success",
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

  return { startCheckout, openPortal, pendingPlanId, portalPending };
}
