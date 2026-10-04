/**
 * Client-side wrappers for `/v1/admin/credits/*`.
 *
 * Mirrors the response shapes returned by `apps/api/src/routes/admin-credits.ts`.
 * Keep both sides in sync; we don't share types via `@clickfy/types`
 * yet because the admin runs in the browser and the API in a Worker
 * bundle.
 */

import type { AssignableEntitlement, PaidTier } from '@clickfy/types';

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

export type ModelStatus = 'active' | 'preview' | 'deprecated';

export interface ProviderModelRow {
  id: string;
  provider: 'gemini' | 'kling' | 'veo' | 'seedance' | 'openai' | 'fal';
  modelKey: string;
  displayName: string;
  status: ModelStatus;
  costCredits: number;
  /** Absolute credits per tier key; null for flat-priced models. */
  tierPricing: Record<string, number> | null;
  costPerCallUsd: string;
  updatedAt: string;
  /** Smoke test: the last test job and its outcome (null = never / pending). */
  lastTestJobId: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
}

export interface ProviderModelDetail extends ProviderModelRow {
  capabilities: Record<string, unknown>;
}

export function fetchModels(getToken: TokenGetter) {
  return apiFetch<ProviderModelRow[]>('/v1/admin/credits/models', { getToken });
}

export function fetchModel(id: string, getToken: TokenGetter) {
  return apiFetch<ProviderModelDetail>(`/v1/admin/credits/models/${id}`, { getToken });
}

export interface ModelUpdate {
  /** Records a freshly submitted smoke-test job on the row. */
  lastTestJobId?: string;
  costCredits?: number;
  displayName?: string;
  status?: ModelStatus;
  costPerCallUsd?: number;
  tierPricing?: Record<string, number> | null;
  capabilities?: Record<string, unknown>;
}

export function updateModel(id: string, patch: ModelUpdate, getToken: TokenGetter) {
  return apiFetch<ProviderModelDetail & { templatesRecomputed: number }>(
    `/v1/admin/credits/models/${id}`,
    { method: 'PATCH', getToken, json: patch },
  );
}

/** Kept for the inline credits editor. */
export function updateModelCost(id: string, costCredits: number, getToken: TokenGetter) {
  return updateModel(id, { costCredits }, getToken);
}

export interface FalFieldSummary {
  name: string;
  type: string;
  required: boolean;
  enum?: unknown[];
  default?: unknown;
  description?: string;
}

export interface FalInspectResult {
  endpointId: string;
  title: string | null;
  description: string | null;
  kind: 'image' | 'video';
  unitPrice: { price: number; unit: string; currency: string } | null;
  inputFields: FalFieldSummary[];
  outputFields: string[];
  draft: Record<string, unknown>;
  suggestedModelKey: string;
  suggestedCredits: number | null;
}

export function inspectFalEndpoint(endpointId: string, getToken: TokenGetter) {
  return apiFetch<FalInspectResult>('/v1/admin/credits/models/fal/inspect', {
    method: 'POST',
    getToken,
    json: { endpointId },
  });
}

export interface CreateFalModelInput {
  modelKey: string;
  displayName: string;
  status: ModelStatus;
  costPerCallUsd: number;
  costCredits: number;
  tierPricing?: Record<string, number> | null;
  capabilities: Record<string, unknown>;
}

export function createFalModel(input: CreateFalModelInput, getToken: TokenGetter) {
  return apiFetch<ProviderModelDetail>('/v1/admin/credits/models', {
    method: 'POST',
    getToken,
    json: input,
  });
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
  entitlement: PaidTier;
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
  entitlement: PaidTier;
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
  audience: { entitlement?: AssignableEntitlement };
  updatedAt: string;
}

export interface GrantPolicyUpdate {
  isActive?: boolean;
  amount?: number;
  periodUnit?: 'day' | 'week' | 'month' | null;
  periodCount?: number | null;
  audience?: { entitlement?: AssignableEntitlement };
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

// ── Smoke test ──────────────────────────────────────────────────────

export interface SmokeTestStatus {
  job: {
    id: string;
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'purged';
    createdAt: string;
    completedAt: string | null;
    error: { code: string; message: string } | null;
    outputs: Array<{ kind: 'image' | 'video'; url: string }>;
  } | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
}

export function fetchSmokeTest(id: string, getToken: TokenGetter) {
  return apiFetch<SmokeTestStatus>(`/v1/admin/credits/models/${id}/smoke-test`, { getToken });
}

/**
 * Submit the smoke-test generation as the signed-in admin (an ordinary
 * user account for this purpose: the job is charged to it like any other).
 * Uses the public create route so the model runs exactly as it would for
 * a customer — same validation, pricing and worker path.
 */
export function submitSmokeTestJob(
  input: { modelKey: string; prompt: string; aspectRatio?: string; quality?: string; duration?: number },
  getToken: TokenGetter,
) {
  return apiFetch<{ jobId: string; status: string }>('/v1/jobs/create', {
    method: 'POST',
    getToken,
    json: input,
  });
}
