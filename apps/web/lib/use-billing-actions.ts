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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { config } from "@/lib/config";
import { ME_QUERY_KEY } from "@/lib/use-session";
import { PLANS_QUERY_KEY } from "@/lib/use-plans";
import { INVOICES_QUERY_KEY, SUBSCRIPTION_QUERY_KEY } from "@/lib/use-subscription";

/** Error codes the API returns that deserve their own message. */
type BillingErrorCode =
  | "subscribed_elsewhere"
  | "plan_not_purchasable"
  | "stripe_unconfigured"
  | "no_stripe_customer"
  | "topup_requires_subscription"
  | "pack_not_purchasable"
  | "already_subscribed";

type PostResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; details?: Record<string, unknown> };

async function post<T>(path: string, token: string | null, body?: unknown): Promise<PostResult<T>> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: T; error?: { code?: string; message?: string; details?: Record<string, unknown> } }
    | null;
  if (!res.ok || !json?.data) {
    return {
      ok: false,
      code: json?.error?.code ?? `http_${res.status}`,
      message: json?.error?.message ?? "Something went wrong.",
      details: json?.error?.details,
    };
  }
  return { ok: true, data: json.data };
}

export function useBillingActions() {
  const { getToken, isSignedIn } = useAuth();
  const t = useTranslations("pricing");
  const tb = useTranslations("billing");
  const queryClient = useQueryClient();
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
      // Back to the dedicated pricing page, not the homepage section —
      // that is where the plans, top-ups and allowance table all are, and
      // the resume hook runs on both.
      window.location.href = `/sign-up?redirect_url=${encodeURIComponent(
        `/pricing?plan=${planId}`,
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
        cancelPath: "/pricing",
      });
      if (!result.ok) {
        // ── They already pay us ──────────────────────────────────────
        //
        // Clicking a plan card is the same gesture whether someone is new,
        // upgrading, or coming back after cancelling — so the API tells us
        // which of those it is and we finish the job, rather than showing
        // an error for a button that did exactly what it looked like it
        // would do.
        if (result.code === ("already_subscribed" satisfies BillingErrorCode)) {
          const action = (result.details as { action?: string } | undefined)?.action;
          await (action === "resume" ? resumeSubscription() : changePlan(planId));
          return;
        }
        // They pay through a store, and sending them to Stripe would bill
        // them twice.
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

  /** Plan, credits and entitlement all move together; none may stay stale. */
  async function refreshBilling() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: INVOICES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: PLANS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
    ]);
  }

  /**
   * Move an existing subscription to another tier.
   *
   * An upgrade is charged and granted immediately; a downgrade is booked
   * for the period end. The API decides which, because the direction is a
   * ladder position rather than a price comparison.
   */
  async function changePlan(planId: string) {
    const token = await getToken();
    const result = await post<{
      direction: "upgrade" | "downgrade";
      effectiveAt: string | null;
      tier: string;
    }>("/v1/billing/change-plan", token, { planId });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    await refreshBilling();
    toast.success(
      result.data.direction === "upgrade"
        ? tb("upgraded", { plan: result.data.tier })
        : tb("downgradeBooked", {
            plan: result.data.tier,
            date: result.data.effectiveAt
              ? new Date(result.data.effectiveAt).toLocaleDateString()
              : "",
          }),
    );
  }

  /** Undo a cancellation that has not taken effect yet. */
  async function resumeSubscription() {
    const token = await getToken();
    const result = await post<{ renewsAt: string | null }>("/v1/billing/resume", token, {});
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    await refreshBilling();
    toast.success(tb("resumed"));
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
      // Straight back to the top-up card they were looking at.
      window.location.href = `/sign-up?redirect_url=${encodeURIComponent("/pricing#topup")}`;
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
    changePlan,
    resumeSubscription,
    startTopup,
    openPortal,
    pendingPlanId,
    pendingPackId,
    portalPending,
  };
}
