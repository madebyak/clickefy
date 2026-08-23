/**
 * useSession — single hook that fuses Clerk's auth state with our Neon
 * `users` row so screens can read `{ user, plan, isAuthed, preferences }`
 * in one shot, and also exposes mutations to edit the profile.
 *
 * Why a wrapper instead of using `useUser()` everywhere:
 *   - `User` (display info) comes from Clerk's identity store.
 *   - `UserPlan` (credits, entitlement, renewal date) and `preferences`
 *     come from our own DB and only Clerk-authenticated requests can
 *     read them.
 *   - Most screens want both, so colocating the fetch keeps call-sites
 *     concise and the cache keys consistent.
 *
 * Cache invalidation: any code that changes credits (job charge, paywall
 * purchase, admin adjust) should call
 *     queryClient.invalidateQueries({ queryKey: ['users', 'me'] })
 * so the next render sees the new balance.
 */

import { useAuth, useUser } from '@clerk/expo';
import * as Sentry from '@sentry/react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_USER_PREFERENCES,
  withPreferenceDefaults,
  type MeResponse,
  type UpdateProfileInput,
  type UserPreferences,
} from '@clickfy/types';
import { useCallback, useEffect } from 'react';

import { unregisterCurrentDeviceAsync } from './push-notifications';
import { getSDK } from './sdk';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUri?: string;
  initials: string;
}

export interface SessionPlan {
  tier: 'Free' | 'Basic' | 'Creator' | 'Pro' | 'Ultimate';
  isPro: boolean;
  credits: number;
  renewsAt?: string;
}

const ENTITLEMENT_TO_TIER: Record<MeResponse['entitlement'], SessionPlan['tier']> = {
  free: 'Free',
  basic: 'Basic',
  creator: 'Creator',
  pro: 'Pro',
  ultimate: 'Ultimate',
  // Retired in migration 0030; an old row still renders as the tier that
  // replaced it rather than showing a name no plan uses any more.
  pro_max: 'Ultimate',
  admin: 'Ultimate',
};

function makeInitials(name: string, email: string): string {
  const seed = name.trim() || email.split('@')[0] || '';
  const parts = seed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export const ME_QUERY_KEY = ['users', 'me'] as const;

export function useSession() {
  const { isLoaded: clerkLoaded, isSignedIn, signOut, getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const queryClient = useQueryClient();

  // Mirror the Clerk user id into Sentry's user scope so any captured
  // exception is automatically tagged. Cleared on sign-out so we don't
  // mis-attribute errors after a user signs out on a shared device.
  useEffect(() => {
    if (isSignedIn && clerkUser?.id) {
      Sentry.setUser({ id: clerkUser.id });
    } else if (clerkLoaded && !isSignedIn) {
      Sentry.setUser(null);
    }
  }, [clerkLoaded, isSignedIn, clerkUser?.id]);

  // NOTE: Push registration used to live here, but `useSession` is
  // called from many screens (TopBar, drawer, profile, edit-profile,
  // appearance, the home screen…). Each mount re-ran the effect, and
  // because Clerk's `getToken` reference is unstable across renders
  // (see clerk/javascript#201) the cleanup → re-subscribe cycle ran
  // several times per second on busy screens — flooding the backend
  // and tripping the rate limiter.
  //
  // The registration now lives in `usePushRegistration` which is
  // mounted exactly once at the root of the app. See
  // `apps/mobile/lib/use-push-registration.ts`.

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    enabled: !!isSignedIn,
    // Goes through the SDK so token attachment, rate-limit (429) parsing
    // and error shaping match every other backend call in the app.
    queryFn: (): Promise<MeResponse> => getSDK().user.getMe(),
    staleTime: 30_000,
    retry: 1,
  });

  // ── Mutations ──────────────────────────────────────────────────────

  const updateProfile = useMutation({
    mutationFn: (input: UpdateProfileInput): Promise<MeResponse> =>
      getSDK().user.updateProfile(input),
    // Optimistic update: write the patch onto the cached row immediately,
    // then reconcile against the server's response (or roll back on error).
    //
    // Defensive note: `previous.preferences` may be missing entirely if
    // the cache was populated by an older API build that didn't include
    // the field yet, by a partial response, or by a hand-written test
    // fixture. `withPreferenceDefaults` collapses all of those to the
    // canonical shape so the spread below can never crash.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ME_QUERY_KEY });
      const previous = queryClient.getQueryData<MeResponse>(ME_QUERY_KEY);
      if (previous) {
        const safePrev = withPreferenceDefaults(previous.preferences);
        const nextPrefs: UserPreferences = input.preferences
          ? {
              appearance: {
                ...safePrev.appearance,
                ...(input.preferences.appearance ?? {}),
              },
              notifications: {
                ...safePrev.notifications,
                ...(input.preferences.notifications ?? {}),
              },
            }
          : safePrev;
        queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, {
          ...previous,
          ...(input.name !== undefined && { name: input.name }),
          ...(input.locale !== undefined && { locale: input.locale }),
          preferences: nextPrefs,
        });
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(ME_QUERY_KEY, ctx.previous);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, data);
    },
  });

  const uploadAvatar = useMutation({
    mutationFn: (file: {
      uri: string;
      name: string;
      type: string;
    }): Promise<MeResponse> => getSDK().user.uploadAvatar(file),
    onSuccess: (data) => {
      queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, data);
    },
  });

  /**
   * Permanently delete the current account.
   *
   * Backend `DELETE /v1/users/me` soft-deletes the row, scrubs PII,
   * schedules asset purge, and calls Clerk's delete API. On success
   * we explicitly sign out + drop the React-Query cache so no stale
   * data lingers across the screen-transition to the welcome page.
   *
   * Required by App Store guideline 5.1.1(v) / Google Play Account
   * Deletion policy. The mutation is exposed here so call-sites only
   * have to wrap it in a confirmation modal.
   */
  const deleteAccount = useMutation({
    mutationFn: async (): Promise<void> => {
      // Unregister this device's push token FIRST, while the session is
      // still valid (the delete below invalidates it). Best-effort — never
      // block account deletion on housekeeping.
      try {
        await unregisterCurrentDeviceAsync(() => getToken());
      } catch {
        /* ignore */
      }
      await getSDK().user.deleteAccount();
    },
    onSuccess: async () => {
      try {
        await signOut();
      } catch (err) {
        console.warn('[deleteAccount] signOut after delete failed', err);
      }
      queryClient.removeQueries();
    },
  });

  // ── Derived shapes ─────────────────────────────────────────────────

  const isReady = clerkLoaded && (!isSignedIn || !meQuery.isLoading);

  const user: SessionUser | null = clerkUser
    ? {
        id: meQuery.data?.id ?? clerkUser.id,
        email:
          meQuery.data?.email ??
          clerkUser.primaryEmailAddress?.emailAddress ??
          clerkUser.emailAddresses?.[0]?.emailAddress ??
          '',
        name:
          meQuery.data?.name ??
          ([clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim() ||
            clerkUser.username ||
            ''),
        avatarUri: meQuery.data?.avatarUrl ?? clerkUser.imageUrl ?? undefined,
        initials: makeInitials(
          meQuery.data?.name ?? clerkUser.firstName ?? '',
          meQuery.data?.email ?? clerkUser.primaryEmailAddress?.emailAddress ?? '',
        ),
      }
    : null;

  const plan: SessionPlan | null = meQuery.data
    ? {
        tier: ENTITLEMENT_TO_TIER[meQuery.data.entitlement],
        isPro: meQuery.data.entitlement !== 'free',
        credits: meQuery.data.creditsBalance,
        renewsAt: meQuery.data.subscriptionRenewsAt ?? undefined,
      }
    : null;

  /**
   * Always-defined preferences shape. While signed-out (or before the
   * first `/me` response lands), returns the canonical defaults so the
   * caller never has to handle `undefined`.
   */
  const preferences: UserPreferences = meQuery.data
    ? withPreferenceDefaults(meQuery.data.preferences)
    : DEFAULT_USER_PREFERENCES;

  const locale: MeResponse['locale'] = meQuery.data?.locale ?? 'en';

  const handleSignOut = useCallback(async () => {
    // Unregister this device's push token BEFORE signing out — the call is
    // user-scoped and needs the still-valid session — so pushes meant for
    // this user never land on the device after they've signed out.
    // Best-effort; never block sign-out on housekeeping.
    try {
      await unregisterCurrentDeviceAsync(() => getToken());
    } catch {
      /* ignore */
    }
    await signOut();
    queryClient.removeQueries();
  }, [signOut, queryClient, getToken]);

  return {
    isReady,
    isAuthed: !!isSignedIn,
    user,
    plan,
    preferences,
    locale,
    signOut: handleSignOut,
    meQuery,
    updateProfile,
    uploadAvatar,
    deleteAccount,
  };
}
