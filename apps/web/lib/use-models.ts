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
  const byKind = kind ? models.filter((m) => m.kind === kind) : models;
  return {
    ...query,
    /**
     * What the composer may OFFER — tool-only models excluded.
     *
     * The Video Upscaler is real and priced, but it takes a clip and a
     * resolution rather than a prompt; listing it in the model dropdown
     * would be listing a dead end.
     */
    models: byKind.filter((m) => !m.toolOnly),
    /**
     * Everything, including tool-only models. A tool modal reads its own
     * model's price from here rather than hard-coding it — the roster
     * exists so a price lives in exactly one place.
     */
    allModels: byKind,
  };
}
