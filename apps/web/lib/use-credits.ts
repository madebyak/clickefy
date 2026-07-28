"use client";

/**
 * Credit-bucket breakdown for the credit menu — `GET /v1/credits/me`.
 * The total mirrors `MeResponse.creditsBalance`; this adds the
 * promo / subscription / topup split and the spendability flag.
 */

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getSDK } from "@/lib/api";

export const CREDITS_QUERY_KEY = ["credits", "me"] as const;

export function useCredits() {
  const { isLoaded, isSignedIn } = useAuth();
  return useQuery({
    queryKey: CREDITS_QUERY_KEY,
    queryFn: () => getSDK().credits.getSummary(),
    enabled: isLoaded && !!isSignedIn,
    staleTime: 30_000,
    retry: 1,
  });
}
