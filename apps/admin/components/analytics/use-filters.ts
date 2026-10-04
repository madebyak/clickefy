'use client';

/**
 * Dashboard filters live in the URL so a breakdown row can link to the
 * jobs page and a refresh keeps the view. Both pages share this hook.
 * Must be rendered under a `<Suspense>` (Next's `useSearchParams` rule).
 */

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { AnalyticsBucket, AnalyticsFilters } from '@clickfy/types';

import { presetRange } from '@/lib/analytics-format';

export interface DashboardFilters extends Omit<AnalyticsFilters, 'from' | 'to'> {
  from: string;
  to: string;
  bucket: AnalyticsBucket;
  search?: string;
}

const KEYS = ['from', 'to', 'bucket', 'model', 'provider', 'userId', 'origin', 'status', 'basis', 'search'] as const;

export function useDashboardFilters(): [DashboardFilters, (patch: Partial<Record<(typeof KEYS)[number], string | undefined>>) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo<DashboardFilters>(() => {
    const def = presetRange('30d');
    const get = (k: string) => sp.get(k) || undefined;
    const bucket = get('bucket');
    return {
      from: get('from') ?? def.from,
      to: get('to') ?? def.to,
      bucket: bucket === 'week' || bucket === 'month' ? bucket : 'day',
      model: get('model'),
      provider: get('provider'),
      userId: get('userId'),
      origin: get('origin') as DashboardFilters['origin'],
      status: get('status') as DashboardFilters['status'],
      basis: get('basis') as DashboardFilters['basis'],
      search: get('search'),
    };
  }, [sp]);

  const set = useCallback(
    (patch: Partial<Record<(typeof KEYS)[number], string | undefined>>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '' || v === 'all') next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  return [filters, set];
}

/** The query-string a link to the jobs page needs to carry these filters. */
export function jobsHref(f: Partial<DashboardFilters>): string {
  const sp = new URLSearchParams();
  for (const k of KEYS) {
    const v = f[k];
    if (v && k !== 'bucket') sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `/admin/jobs?${qs}` : '/admin/jobs';
}
