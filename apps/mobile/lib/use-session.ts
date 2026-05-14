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

import { registerForPushNotificationsAsync } from './push-notifications';

import { config } from './config';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUri?: string;
  initials: string;
}

export interface SessionPlan {
  tier: 'Free' | 'Pro' | 'Pro Max';
  isPro: boolean;
  credits: number;
  renewsAt?: string;
}

const ENTITLEMENT_TO_TIER: Record<MeResponse['entitlement'], SessionPlan['tier']> = {
  free: 'Free',
  pro: 'Pro',
  pro_max: 'Pro Max',
  admin: 'Pro Max',
};

function makeInitials(name: string, email: string): string {
  const seed = name.trim() || email.split('@')[0] || '';
  const parts = seed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

const ME_QUERY_KEY = ['users', 'me'] as const;

export function useSession() {
  const { isLoaded: clerkLoaded, isSignedIn, getToken, signOut } = useAuth();
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

  // Register this device for push notifications once we have an
  // authenticated session. Idempotent — the backend upserts by token
  // so calling on every cold start is safe. We deliberately do NOT
  // block the sign-in flow on the result; a denied permission, an
  // emulator, or a network blip should never prevent the user from
  // continuing into the app.
  useEffect(() => {
    if (!isSignedIn || !clerkUser?.id) return;
    void registerForPushNotificationsAsync(async () => getToken()).then((result) => {
      if (result.token) {
        console.log('[push] registered', result.token.slice(0, 24) + '...');
      } else if (result.reason && result.reason !== 'simulator') {
        // 'simulator' is the expected outcome on iOS Sim / Android
        // Emulator and not worth surfacing as a warning.
        console.log('[push] register skipped:', result.reason);
      }
    });
  }, [isSignedIn, clerkUser?.id, getToken]);

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    enabled: !!isSignedIn,
    queryFn: async (): Promise<MeResponse> => {
      const token = await getToken();
      const res = await fetch(`${config.apiUrl}/v1/users/me`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`GET /v1/users/me ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as { data: MeResponse };
      return json.data;
    },
    staleTime: 30_000,
    retry: 1,
  });

  // ── Mutations ──────────────────────────────────────────────────────

  const updateProfile = useMutation({
    mutationFn: async (input: UpdateProfileInput): Promise<MeResponse> => {
      const token = await getToken();
      const res = await fetch(`${config.apiUrl}/v1/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`PATCH /v1/users/me ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as { data: MeResponse };
      return json.data;
    },
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
    mutationFn: async (file: {
      uri: string;
      name: string;
      type: string;
    }): Promise<MeResponse> => {
      const token = await getToken();
      const formData = new FormData();
      // React Native FormData accepts an object with `uri/name/type` and
      // the runtime constructs the multipart payload from it.
      formData.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.type,
      } as unknown as Blob);
      const res = await fetch(`${config.apiUrl}/v1/users/me/avatar`, {
        method: 'POST',
        headers: {
          // Don't set Content-Type — fetch sets it with the multipart
          // boundary automatically.
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `POST /v1/users/me/avatar ${res.status}: ${body.slice(0, 200)}`,
        );
      }
      const json = (await res.json()) as { data: MeResponse };
      return json.data;
    },
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
      const token = await getToken();
      const res = await fetch(`${config.apiUrl}/v1/users/me`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.text();
        throw new Error(`DELETE /v1/users/me ${res.status}: ${body.slice(0, 200)}`);
      }
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
    await signOut();
    queryClient.removeQueries();
  }, [signOut, queryClient]);

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
