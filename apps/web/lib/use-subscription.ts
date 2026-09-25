"use client";

/**
 * The live state of a subscription, and the four things you can do to it.
 *
 * Separate from `usePlans` because it answers a different question. The
 * catalogue is public, cacheable and the same for everybody; this is one
 * person's billing, read fresh from Stripe on every load — whether their
 * plan is set to end, what card is on file, what changes next month. Any
 * of those can be altered in Stripe's own portal without us hearing until
 * a webhook lands, so a long cache here would show someone a page that
 * confidently contradicts what they just did.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";

import { config } from "@/lib/config";
import { ME_QUERY_KEY } from "@/lib/use-session";
import { PLANS_QUERY_KEY } from "@/lib/use-plans";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "incomplete"
  | "canceled";

export interface PendingPlanChange {
  tier: string | null;
  interval: string | null;
  planId: string | null;
  /** When it takes effect — the end of the period already paid for. */
  effectiveAt: string | null;
}

export interface LiveSubscription {
  id: string;
  status: SubscriptionStatus;
  tier: string | null;
  interval: string | null;
  planId: string | null;
  creditsPerPeriod: number | null;
  currentPeriodEnd: string | null;
  /** Cancelled — here or in Stripe's portal: access runs to `endsAt`, then stops. */
  cancelAtPeriodEnd: boolean;
  endsAt: string | null;
  /** A downgrade already booked for the period end. */
  pendingChange: PendingPlanChange | null;
}

export interface SubscriptionResponse {
  entitlement: string;
  /** Null for a comped plan or a free account — no Stripe controls apply. */
  platform: "stripe" | "app_store" | "play_store" | null;
  expiresAt: string | null;
  subscription: LiveSubscription | null;
  paymentMethod: { brand: string; last4: string; expMonth: number; expYear: number } | null;
}

export interface Invoice {
  id: string;
  /** A Stripe invoice (PDF), or a receipt for a pack bought before packs had invoices. */
  kind: "invoice" | "receipt";
  number: string | null;
  status: string;
  description: string | null;
  amountPaid: number;
  amountDue: number;
  currency: string;
  createdAt: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
}

export const SUBSCRIPTION_QUERY_KEY = ["billing", "subscription"] as const;
export const INVOICES_QUERY_KEY = ["billing", "invoices"] as const;

function useAuthedFetch() {
  const { getToken } = useAuth();
  return async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = await getToken();
    const res = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    const json = (await res.json().catch(() => null)) as
      | { data?: T; error?: { code?: string; message?: string } }
      | null;
    if (!res.ok || !json?.data) {
      const err = new Error(json?.error?.message ?? `request failed (${res.status})`);
      // Carried so callers can branch on the case rather than the prose.
      (err as Error & { code?: string }).code = json?.error?.code;
      throw err;
    }
    return json.data;
  };
}

export function useSubscription() {
  const { isLoaded, isSignedIn } = useAuth();
  const authedFetch = useAuthedFetch();

  return useQuery({
    queryKey: SUBSCRIPTION_QUERY_KEY,
    queryFn: () => authedFetch<SubscriptionResponse>("/v1/billing/subscription"),
    enabled: isLoaded && !!isSignedIn,
    // Short: a customer who just cancelled in Stripe's portal and came
    // back should not be told they are still subscribed.
    staleTime: 10_000,
  });
}

export function useInvoices(enabled = true) {
  const { isLoaded, isSignedIn } = useAuth();
  const authedFetch = useAuthedFetch();

  return useQuery({
    queryKey: INVOICES_QUERY_KEY,
    queryFn: async () =>
      (await authedFetch<{ invoices: Invoice[] }>("/v1/billing/invoices")).invoices,
    enabled: enabled && isLoaded && !!isSignedIn,
    staleTime: 60_000,
  });
}

/**
 * Change plan, cancel, resume.
 *
 * Each one invalidates the subscription, the catalogue AND the user —
 * an upgrade moves credits and entitlement, and leaving any of the three
 * stale shows a balance that disagrees with the plan beside it.
 */
export function useSubscriptionActions() {
  const authedFetch = useAuthedFetch();
  const queryClient = useQueryClient();

  const refreshEverything = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: INVOICES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: PLANS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
    ]);
  };

  const changePlan = useMutation({
    mutationFn: (planId: string) =>
      authedFetch<{
        direction: "upgrade" | "downgrade";
        chargedNow: boolean;
        effectiveAt: string | null;
        tier: string;
        interval: string;
      }>("/v1/billing/change-plan", {
        method: "POST",
        body: JSON.stringify({ planId }),
      }),
    onSuccess: refreshEverything,
  });

  const cancel = useMutation({
    mutationFn: (input: { reason?: string; comment?: string }) =>
      authedFetch<{ cancelAtPeriodEnd: true; accessUntil: string | null }>("/v1/billing/cancel", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: refreshEverything,
  });

  const resume = useMutation({
    mutationFn: () =>
      authedFetch<{ cancelAtPeriodEnd: false; pendingChangeCancelled: boolean; renewsAt: string | null }>(
        "/v1/billing/resume",
        { method: "POST", body: JSON.stringify({}) },
      ),
    onSuccess: refreshEverything,
  });

  return { changePlan, cancel, resume };
}
