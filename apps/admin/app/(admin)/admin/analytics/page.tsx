'use client';

/**
 * Analytics — cost & profit dashboard (Phase 2, feature 1).
 *
 * Reads `/v1/admin/analytics/costs` and `/costs/by`. Every number is
 * defined once in `@clickfy/types/admin-analytics`; the short version:
 * cost = what providers charged us, credit value = paid credits × $0.10
 * (promo excluded), profit = credit value − cost, cash = Stripe money
 * net of refunds. Periods are Dubai calendar days.
 */

import { Suspense, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Coins, Download, Gift, Percent, Receipt, Zap } from 'lucide-react';
import { toast } from 'sonner';

import type { AnalyticsBucket } from '@clickfy/types';

import { Breakdown } from '@/components/analytics/breakdown';
import { CostChart } from '@/components/analytics/cost-chart';
import { InvoicePanel } from '@/components/analytics/invoices';
import { Kpi } from '@/components/analytics/kpi';
import { RangePicker } from '@/components/analytics/range-picker';
import { useDashboardFilters } from '@/components/analytics/use-filters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { downloadCsv, fetchCosts, monthlyExportPath } from '@/lib/api/analytics';
import { cents, int, pct, signedUsd, usd, ymdLabel } from '@/lib/analytics-format';

const BUCKET_LABEL: Record<AnalyticsBucket, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' };

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <AnalyticsDashboard />
    </Suspense>
  );
}

function AnalyticsDashboard() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);
  const [filters, setFilters] = useDashboardFilters();
  const { from, to, bucket, model, provider, userId, origin, status, basis } = filters;
  const q = { from, to, model, provider, userId, origin, status, basis };

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'analytics', 'costs', q, bucket],
    queryFn: () => fetchCosts(tokenGetter, { ...q, bucket }),
    staleTime: 30_000,
  });

  const [exporting, setExporting] = useState(false);
  async function exportMonth() {
    setExporting(true);
    try {
      await downloadCsv(tokenGetter, monthlyExportPath(to.slice(0, 7)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const activeFilters = Object.entries({ model, provider, userId, origin, status, basis }).filter(([, v]) => v) as Array<[string, string]>;
  const t = data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cost &amp; profit</h1>
          <p className="mt-1 text-muted-foreground">
            What generations cost us, what the paid credits behind them were worth, and the cash that came in. Dubai time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker from={from} to={to} onChange={(r) => setFilters(r)} />
          <Select value={bucket} onValueChange={(v) => setFilters({ bucket: v as string })}>
            <SelectTrigger className="w-28"><SelectValue>{(v) => BUCKET_LABEL[v as AnalyticsBucket]}</SelectValue></SelectTrigger>
            <SelectContent>
              {(Object.keys(BUCKET_LABEL) as AnalyticsBucket[]).map((b) => <SelectItem key={b} value={b}>{BUCKET_LABEL[b]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportMonth} disabled={exporting} title={`Per-model CSV for ${to.slice(0, 7)}`}>
            <Download className="mr-2 h-4 w-4" />{exporting ? 'Exporting…' : `Models CSV · ${to.slice(0, 7)}`}
          </Button>
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filtered:</span>
          {activeFilters.map(([k, v]) => (
            <Badge key={k} variant="secondary" className="cursor-pointer gap-1" onClick={() => setFilters({ [k]: undefined })} title="Remove filter">
              {k} = {v} ×
            </Badge>
          ))}
          <Button variant="ghost" size="xs" onClick={() => setFilters(Object.fromEntries(activeFilters.map(([k]) => [k, undefined])))}>Clear all</Button>
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Could not load analytics'}
        </div>
      ) : isLoading || !data || !t ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Profit" value={signedUsd(t.profitUsd)} hint={`margin ${pct(t.marginPct)} · credit value − cost`} icon={Percent}
              tone={t.profitUsd < 0 ? 'text-destructive' : 'text-primary-green'} />
            <Kpi label="Credit value" value={usd(t.creditValueUsd)} hint={`${int(t.paidCreditsNet)} paid credits × $0.10`} icon={Coins} tone="text-primary-purple" />
            <Kpi label="Provider cost" value={usd(t.costUsd)} hint={`${usd(t.failedCostUsd)} of it on failed jobs`} icon={Receipt} tone="text-warning" />
            <Kpi label="Cash received" value={t.cash ? cents(t.cash.netCents) : '—'}
              hint={t.cash ? `${t.cash.count} payments · subs ${cents(t.cash.subscriptionCents)} · packs ${cents(t.cash.packCents)}` : 'not shown with model-level filters'}
              icon={Banknote} tone="text-primary-green" />
            <Kpi label="Generations" value={int(t.jobs)} hint={`${int(t.completed)} completed · ${int(t.failed)} failed${t.running ? ` · ${t.running} running` : ''}`} icon={Zap} />
            <Kpi label="Promo credits used" value={int(t.promoCreditsNet)} hint="free credits consumed; no revenue behind them" icon={Gift} />
            <Kpi label="Cash − cost" value={t.cashProfitUsd != null ? signedUsd(t.cashProfitUsd) : '—'} hint="cross-check only; cash lands before credits are spent" icon={Banknote} />
            <Kpi label="Cost basis" value={`${pct(t.jobs ? ((t.basis.exact + t.basis.computed) / Math.max(1, t.completed + t.failed)) * 100 : null, 0)} live`}
              hint={`${int(t.basis.exact)} exact · ${int(t.basis.computed)} computed · ${int(t.basis.estimated)} estimated${t.basis.unpriced ? ` · ${int(t.basis.unpriced)} unpriced` : ''}`}
              icon={AlertTriangle} tone={t.basis.unpriced ? 'text-warning' : 'text-muted-foreground'} />
          </div>

          <CostChart series={data.series} bucket={bucket} />

          <Breakdown filters={filters} getToken={tokenGetter} />

          <InvoicePanel rows={data.invoices} getToken={tokenGetter} />

          <p className="text-xs text-muted-foreground">
            {ymdLabel(from)} – {ymdLabel(to)} · Dubai calendar · a job counts on the day it was created; a payment on the day it was made ·
            estimated = back-filled from today&apos;s rate card, computed = rate card × actual units, exact = units reported by the provider.
          </p>
        </>
      )}
    </div>
  );
}
