"use client";

/**
 * Create-flow model roster — `GET /v1/models` (auth required). Drives
 * the entire model-adaptive prompt bar: picker entries, aspect ratios,
 * durations, quality tiers, attachment mode, prompt cap, and cost.
 */

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import type { GenModel } from "@clickfy/sdk";
import { getSDK } from "@/lib/api";

export const MODELS_QUERY_KEY = ["models"] as const;

export function useModels(kind?: "image" | "video") {
  const { isLoaded, isSignedIn } = useAuth();
  const query = useQuery({
    queryKey: MODELS_QUERY_KEY,
    queryFn: () => getSDK().models.listModels(),
    enabled: isLoaded && !!isSignedIn,
    // The roster changes only when admin re-prices; cache generously.
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const models: GenModel[] = query.data ?? [];
  return {
    ...query,
    models: kind ? models.filter((m) => m.kind === kind) : models,
  };
}
