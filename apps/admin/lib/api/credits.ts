/**
 * Client-side wrappers for `/v1/admin/credits/*`.
 *
 * Mirrors the response shapes returned by `apps/api/src/routes/admin-credits.ts`.
 * Keep both sides in sync; we don't share types via `@clickfy/types`
 * yet because the admin runs in the browser and the API in a Worker
 * bundle.
 */

import { apiFetch, type TokenGetter } from '@/lib/api';

// ── Overview ────────────────────────────────────────────────────────

export interface CreditsOverview {
  ledger: {
    issued_lifetime: number;
    spent_lifetime: number;
    issued_7d: number;
    spent_7d: number;
  };
  topBurners: Array<{
    templateId: string;
    title: string;
    spent: number;
    runs: number;
  }>;
  catalog: {
    unpricedModels: number;
    activePacks: number;
    totalPacks: number;
    activeSubscriptions: number;
    totalSubscriptions: number;
  };
  recentBroadcasts: Array<{
    id: string;
    amount: number;
    reason: string;
    recipientCount: number;
    grantedCount: number;
    sentAt: string;
  }>;
  window: { last24h: string; last7d: string };
}

export function fetchCreditsOverview(getToken: TokenGetter) {
  return apiFetch<CreditsOverview>('/v1/admin/credits/overview', { getToken });
}

// ── Models ──────────────────────────────────────────────────────────

export interface ProviderModelRow {
  id: string;
  provider: 'gemini' | 'kling' | 'veo';
  modelKey: string;
  displayName: string;
  status: 'active' | 'preview' | 'deprecated';
  costCredits: number;
  costPerCallUsd: string;
  updatedAt: string;
}

export function fetchModels(getToken: TokenGetter) {
  return apiFetch<ProviderModelRow[]>('/v1/admin/credits/models', { getToken });
}

export function updateModelCost(
  id: string,
  costCredits: number,
  getToken: TokenGetter,
) {
  return apiFetch<ProviderModelRow & { templatesRecomputed: number }>(
    `/v1/admin/credits/models/${id}`,
    { method: 'PATCH', getToken, json: { costCredits } },
  );
}

// ── Credit packs ────────────────────────────────────────────────────

export interface CreditPackRow {
  id: string;
  storeProductId: string;
  displayName: string;
  credits: number;
  bonusCredits: number;
  displayOrder: number;
  isFeatured: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditPackInput {
  storeProductId: string;
  displayName: string;
  credits: number;
  bonusCredits?: number;
  displayOrder?: number;
  isFeatured?: boolean;
  isActive?: boolean;
  notes?: string;
}

export function fetchPacks(getToken: TokenGetter) {
  return apiFetch<CreditPackRow[]>('/v1/admin/credits/packs', { getToken });
}

export function createPack(input: CreditPackInput, getToken: TokenGetter) {
  return apiFetch<CreditPackRow>('/v1/admin/credits/packs', {
    method: 'POST',
    getToken,
    json: input,
  });
}

export function updatePack(
  id: string,
  input: Partial<CreditPackInput>,
  getToken: TokenGetter,
) {
  return apiFetch<CreditPackRow>(`/v1/admin/credits/packs/${id}`, {
    method: 'PATCH',
    getToken,
    json: input,
  });
}

export function deletePack(id: string, getToken: TokenGetter) {
  return apiFetch<{ id: string; isActive: false }>(
    `/v1/admin/credits/packs/${id}`,
    { method: 'DELETE', getToken },
  );
}

// ── Subscription plans ──────────────────────────────────────────────

export interface SubscriptionPlanRow {
  id: string;
  storeProductId: string;
  displayName: string;
  entitlement: 'pro' | 'pro_max';
  intervalUnit: 'week' | 'month' | 'year';
  intervalCount: number;
  creditsPerPeriod: number;
  displayOrder: number;
  isFeatured: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionPlanInput {
  storeProductId: string;
  displayName: string;
  entitlement: 'pro' | 'pro_max';
  intervalUnit: 'week' | 'month' | 'year';
  intervalCount?: number;
  creditsPerPeriod: number;
  displayOrder?: number;
  isFeatured?: boolean;
  isActive?: boolean;
  notes?: string;
}

export function fetchSubscriptions(getToken: TokenGetter) {
  return apiFetch<SubscriptionPlanRow[]>('/v1/admin/credits/subscriptions', {
    getToken,
  });
}

export function createSubscription(
  input: SubscriptionPlanInput,
  getToken: TokenGetter,
) {
  return apiFetch<SubscriptionPlanRow>('/v1/admin/credits/subscriptions', {
    method: 'POST',
    getToken,
    json: input,
  });
}

export function updateSubscription(
  id: string,
  input: Partial<SubscriptionPlanInput>,
  getToken: TokenGetter,
) {
  return apiFetch<SubscriptionPlanRow>(
    `/v1/admin/credits/subscriptions/${id}`,
    { method: 'PATCH', getToken, json: input },
  );
}

export function deleteSubscription(id: string, getToken: TokenGetter) {
  return apiFetch<{ id: string; isActive: false }>(
    `/v1/admin/credits/subscriptions/${id}`,
    { method: 'DELETE', getToken },
  );
}

// ── Grant policies ──────────────────────────────────────────────────

export type GrantPolicyKind = 'welcome' | 'periodic_free_refresh';

export interface GrantPolicyRow {
  id: string;
  kind: GrantPolicyKind;
  isActive: boolean;
  amount: number;
  periodUnit: 'day' | 'week' | 'month' | null;
  periodCount: number | null;
  audience: { entitlement?: 'free' | 'pro' | 'pro_max' };
  updatedAt: string;
}

export interface GrantPolicyUpdate {
  isActive?: boolean;
  amount?: number;
  periodUnit?: 'day' | 'week' | 'month' | null;
  periodCount?: number | null;
  audience?: { entitlement?: 'free' | 'pro' | 'pro_max' };
}

export function fetchGrants(getToken: TokenGetter) {
  return apiFetch<GrantPolicyRow[]>('/v1/admin/credits/grants', { getToken });
}

export function updateGrant(
  kind: GrantPolicyKind,
  input: GrantPolicyUpdate,
  getToken: TokenGetter,
) {
  return apiFetch<GrantPolicyRow>(`/v1/admin/credits/grants/${kind}`, {
    method: 'PATCH',
    getToken,
    json: input,
  });
}

// ── Ledger sample ───────────────────────────────────────────────────

export interface LedgerSampleRow {
  id: string;
  userId: string;
  delta: number;
  reason: string;
  bucket: string | null;
  jobId: string | null;
  balanceAfter: number;
  note: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function fetchLedgerSample(getToken: TokenGetter, limit = 50) {
  return apiFetch<LedgerSampleRow[]>(
    `/v1/admin/credits/ledger?limit=${limit}`,
    { getToken },
  );
}
