"use client";

/**
 * Session hook — fuses Clerk auth state with the app's own DB user row
 * (`GET /v1/users/me`). Web port of `apps/mobile/lib/use-session.ts`.
 *
 * Cache-invalidation contract (same as mobile): anything that changes
 * credits or profile must invalidate `ME_QUERY_KEY`.
 */

import { useCallback } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeResponse, UpdateProfileInput } from "@clickfy/types";
import { getSDK } from "@/lib/api";

export const ME_QUERY_KEY = ["users", "me"] as const;

const ENTITLEMENT_TIER: Record<MeResponse["entitlement"], string> = {
  free: "Free",
  basic: "Basic",
  creator: "Creator",
  pro: "Pro",
  ultimate: "Ultimate",
  // Retired in migration 0030; kept so an old row still renders.
  pro_max: "Ultimate",
  admin: "Ultimate",
};

export function useSession() {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut: clerkSignOut } = useClerk();
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => getSDK().user.getMe(),
    enabled: isLoaded && !!isSignedIn,
    staleTime: 30_000,
    retry: 1,
  });

  const updateProfile = useMutation({
    mutationFn: (input: UpdateProfileInput) => getSDK().user.updateProfile(input),
    onSuccess: (me) => queryClient.setQueryData(ME_QUERY_KEY, me),
  });

  const uploadAvatar = useMutation({
    mutationFn: (file: File) =>
      getSDK().user.uploadAvatar({ file, name: file.name, type: file.type }),
    onSuccess: (me) => queryClient.setQueryData(ME_QUERY_KEY, me),
  });

  const signOut = useCallback(async () => {
    queryClient.removeQueries();
    await clerkSignOut({ redirectUrl: "/" });
  }, [clerkSignOut, queryClient]);

  const user = meQuery.data ?? null;
  const entitlement = user?.entitlement ?? "free";

  return {
    /** Clerk finished loading (regardless of signed-in state). */
    isReady: isLoaded,
    isAuthed: isLoaded && !!isSignedIn,
    /** The Neon `users` row — null until the `/me` query resolves. */
    user,
    plan: {
      entitlement,
      /** Display tier: Free / Pro / Pro Max. */
      tier: ENTITLEMENT_TIER[entitlement],
      isPro: entitlement !== "free",
      credits: user?.creditsBalance ?? 0,
    },
    meQuery,
    updateProfile,
    uploadAvatar,
    signOut,
  };
}
