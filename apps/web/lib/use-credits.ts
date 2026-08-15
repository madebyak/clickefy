"use client";

/**
 * Credit-bucket breakdown for the credit menu.
 *
 * This used to be its own `GET /v1/credits/me` query. It no longer is:
 * that endpoint and `GET /v1/users/me` are both pure projections of the
 * SAME `users` row, so the browser was making two requests — and the
 * Worker two Neon reads — to receive one row twice. Worse, being a
 * separate query key gave the credit widget its own loading state, which
 * is why the balance appeared a beat after the profile.
 *
 * `MeResponse` now carries `creditBuckets` + `topupSpendable`, so the
 * summary is derived from the `/me` cache with no extra network call and
 * no second skeleton. The invalidation contract is unchanged and in fact
 * simpler: anything that moves credits already invalidates
 * `ME_QUERY_KEY`, which now updates this view too.
 *
 * `/v1/credits/me` still exists and is still the canonical endpoint —
 * mobile's credits screen uses it. Only the web's duplicate call is gone.
 */

import { useMemo } from "react";
import type { CreditsSummary } from "@clickfy/sdk";
import { useSession } from "@/lib/use-session";

export function useCredits(): { data: CreditsSummary | undefined; isLoading: boolean } {
  const { user, meQuery } = useSession();

  const data = useMemo<CreditsSummary | undefined>(() => {
    if (!user) return undefined;
    return {
      buckets: user.creditBuckets,
      total: user.creditsBalance,
      entitlement: user.entitlement,
      topupSpendable: user.topupSpendable,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
    };
  }, [user]);

  return { data, isLoading: meQuery.isLoading };
}
