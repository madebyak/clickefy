"use client";

/**
 * The plan catalogue, from `GET /v1/billing/plans`.
 *
 * Deliberately NOT `/v1/store` — that endpoint serves the shipped mobile
 * app's older shape and must not be reshaped under it.
 *
 * Works signed-out: the pricing page has to render for visitors, so this
 * query is not gated on auth. When a user IS signed in the response also
 * carries their live subscription, including WHICH PLATFORM it lives on —
 * the one fact that stops someone paying twice for the same plan on two
 * storefronts.
 */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";

import { config } from "@/lib/config";

export type PlanInterval = "month" | "year";
export type PlanTier = "basic" | "creator" | "pro" | "ultimate";
export type BillingPlatform = "stripe" | "app_store" | "play_store";

export interface CataloguePlan {
  id: string;
  tier: PlanTier;
  interval: PlanInterval;
  creditsPerPeriod: number;
  displayName: string;
  displayOrder: number;
  /** Which storefronts can sell this today. Empty = not purchasable yet. */
  products: Partial<Record<BillingPlatform, string>>;
}

export interface CurrentSubscription {
  tier: string;
  platform: BillingPlatform | null;
  productId: string | null;
  expiresAt: string | null;
}

/** One model as the pricing table shows it: real price, default settings. */
export interface CatalogueModel {
  key: string;
  name: string;
  kind: "image" | "video";
  /** Credits for one generation at the default quality and clip length. */
  credits: number;
  /** Default quality tier, already labelled for humans ("720p", "1K"). */
  quality: string | null;
  /** Clip length the price is quoted at. Null for images. */
  seconds: number | null;
  preview: boolean;
}

export interface PlansResponse {
  plans: CataloguePlan[];
  models: CatalogueModel[];
  freeCredits: number;
  current: CurrentSubscription | null;
  entitlement: string | null;
  packs: Array<{
    id: string;
    storeProductId: string;
    displayName: string;
    credits: number;
    bonusCredits: number;
  }>;
  topupsLocked: boolean;
}

export const PLANS_QUERY_KEY = ["billing", "plans"] as const;

export function usePlans() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  return useQuery({
    queryKey: [...PLANS_QUERY_KEY, isSignedIn ?? false],
    queryFn: async (): Promise<PlansResponse> => {
      const headers: Record<string, string> = { Accept: "application/json" };
      // Send the token when we have one so the response can include the
      // user's current subscription; the endpoint works fine without it.
      if (isSignedIn) {
        const token = await getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(`${config.apiUrl}/v1/billing/plans`, { headers });
      if (!res.ok) throw new Error(`plans ${res.status}`);
      const json = (await res.json()) as { data: PlansResponse };
      return json.data;
    },
    // Signed-out visitors must not wait on Clerk to resolve before the
    // pricing page can render.
    enabled: isLoaded || !isSignedIn,
    staleTime: 60_000,
  });
}

/**
 * Can this browser sell the user a plan right now?
 *
 * Blocked when they already subscribe through a store, because Stripe
 * cannot see or replace an Apple subscription — charging them here would
 * simply bill them twice. The only correct answer is to send them back to
 * where the subscription lives.
 */
export function purchaseState(current: CurrentSubscription | null): {
  canBuy: boolean;
  managedOn: "web" | "ios" | "android" | null;
} {
  if (!current) return { canBuy: true, managedOn: null };
  if (current.platform === "app_store") return { canBuy: false, managedOn: "ios" };
  if (current.platform === "play_store") return { canBuy: false, managedOn: "android" };
  // Subscribed via Stripe (or a legacy row with no platform recorded) —
  // upgrades and downgrades happen in the Customer Portal.
  return { canBuy: true, managedOn: "web" };
}
