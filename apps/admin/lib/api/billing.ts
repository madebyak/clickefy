/**
 * Client wrappers for `/v1/admin/billing/*`.
 *
 * Mirrors `apps/api/src/routes/admin-billing.ts`. Kept in step by hand,
 * the same way `credits.ts` is: the admin runs in a browser and the API in
 * a Worker bundle, so the shapes are not shared through a package yet.
 */

import { apiFetch, type TokenGetter } from '@/lib/api';

/** Where a paid entitlement came from. `comped` means nobody paid. */
export type SubscriberSource = 'stripe' | 'app_store' | 'play_store' | 'comped';

export interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  tier: string;
  source: SubscriberSource;
  productId: string | null;
  renewsAt: string | null;
  expiresAt: string | null;
  credits: number;
  stripeCustomerId: string | null;
  /** Monthly value in USD; a yearly plan counts as a twelfth of itself. */
  mrrUsd: number;
  since: string;
}

export interface SubscribersResponse {
  subscribers: Subscriber[];
  summary: {
    total: number;
    bySource: Record<string, { count: number; mrrUsd: number }>;
    byTier: Record<string, number>;
    mrrUsd: number;
  };
}

export function fetchSubscribers(getToken: TokenGetter) {
  return apiFetch<SubscribersResponse>('/v1/admin/billing/subscribers', { getToken });
}

export interface BillingActivityRow {
  created_at: string;
  email: string;
  delta: number;
  reason: string;
  note: string | null;
  source_platform: string | null;
}

export function fetchBillingActivity(getToken: TokenGetter) {
  return apiFetch<{ activity: BillingActivityRow[] }>('/v1/admin/billing/activity', { getToken });
}
