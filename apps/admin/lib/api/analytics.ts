/**
 * Client-side wrappers for `/v1/admin/analytics/*`.
 *
 * Response shapes come straight from `@clickfy/types` (the API builds
 * them from the same types), so this file only knows the paths.
 */

import type {
  AnalyticsBucket,
  AnalyticsDimension,
  AnalyticsFilters,
  AnalyticsJobsResponse,
  CostBreakdownResponse,
  CostsResponse,
} from '@clickfy/types';

import { apiFetch, type TokenGetter } from '@/lib/api';

export type AnalyticsQuery = Partial<AnalyticsFilters>;

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function fetchCosts(getToken: TokenGetter, q: AnalyticsQuery & { bucket?: AnalyticsBucket }) {
  return apiFetch<CostsResponse>(`/v1/admin/analytics/costs${qs(q)}`, { getToken });
}

export function fetchCostBreakdown(getToken: TokenGetter, q: AnalyticsQuery & { dim: AnalyticsDimension; limit?: number }) {
  return apiFetch<CostBreakdownResponse>(`/v1/admin/analytics/costs/by${qs(q)}`, { getToken });
}

export function fetchAnalyticsJobs(
  getToken: TokenGetter,
  q: AnalyticsQuery & { search?: string; cursor?: string; limit?: number },
) {
  return apiFetch<AnalyticsJobsResponse>(`/v1/admin/analytics/jobs${qs(q)}`, { getToken, unwrap: false });
}

/** Paths for the two CSV downloads; fetch with `downloadCsv` so the bearer token travels along. */
export function jobsExportPath(q: AnalyticsQuery): string {
  return `/v1/admin/analytics/export.csv${qs(q)}`;
}
export function monthlyExportPath(month: string): string {
  return `/v1/admin/analytics/export-monthly.csv${qs({ month })}`;
}

export async function downloadCsv(getToken: TokenGetter, path: string): Promise<void> {
  const token = await getToken();
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export.csv';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ProviderInvoiceInput {
  provider: string;
  /** YYYY-MM */
  month: string;
  amountUsd: number;
  note?: string | null;
}

export function upsertProviderInvoice(getToken: TokenGetter, body: ProviderInvoiceInput) {
  return apiFetch<{ id: string; provider: string; month: string; billedUsd: number; note: string | null; updatedAt: string }>(
    '/v1/admin/analytics/invoices',
    { method: 'PUT', json: body, getToken },
  );
}

export function deleteProviderInvoice(getToken: TokenGetter, id: string) {
  return apiFetch<void>(`/v1/admin/analytics/invoices/${id}`, { method: 'DELETE', getToken });
}
