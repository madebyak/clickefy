'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';

import type { AnalyticsDimension, CostBreakdownRow } from '@clickfy/types';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchCostBreakdown } from '@/lib/api/analytics';
import { cents, int, marginTone, pct, signedUsd, usd } from '@/lib/analytics-format';
import type { TokenGetter } from '@/lib/api';

import { jobsHref, type DashboardFilters } from './use-filters';

const DIMS: Array<{ key: AnalyticsDimension; label: string }> = [
  { key: 'model', label: 'By model' },
  { key: 'provider', label: 'By provider' },
  { key: 'user', label: 'By user' },
  { key: 'origin', label: 'By origin' },
  { key: 'template', label: 'By template' },
];

/** The filter a row adds when the admin drills into its jobs. */
function rowFilter(dim: AnalyticsDimension, row: CostBreakdownRow): Partial<DashboardFilters> | null {
  switch (dim) {
    case 'model': return row.key === 'unknown' ? null : { model: row.key };
    case 'provider': return row.key === 'unknown' ? null : { provider: row.key };
    case 'user': return { userId: row.key };
    case 'origin': return { origin: row.key as DashboardFilters['origin'] };
    case 'template': return null;
  }
}

export function Breakdown({ filters, getToken }: { filters: DashboardFilters; getToken: TokenGetter }) {
  const [dim, setDim] = useState<AnalyticsDimension>('model');
  const { from, to, model, provider, userId, origin, status, basis } = filters;
  const q = { from, to, model, provider, userId, origin, status, basis };
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'analytics', 'by', dim, q],
    queryFn: () => fetchCostBreakdown(getToken, { ...q, dim, limit: 100 }),
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardDescription className="text-sm font-medium">Where the money goes</CardDescription>
        <Tabs value={dim} onValueChange={(v) => setDim(v as AnalyticsDimension)}>
          <TabsList>
            {DIMS.map((d) => <TabsTrigger key={d.key} value={d.key}>{d.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading || !data ? (
          <div className="space-y-2 p-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : data.rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No jobs in this range.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{DIMS.find((d) => d.key === dim)?.label.replace('By ', '')}</TableHead>
                <TableHead className="text-right">Jobs</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Avg cost</TableHead>
                <TableHead className="text-right">Paid credits</TableHead>
                <TableHead className="text-right">Credit value</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                {dim === 'user' && <TableHead className="text-right">Cash</TableHead>}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => {
                const f = rowFilter(dim, r);
                return (
                  <TableRow key={r.key}>
                    <TableCell className="max-w-[280px]">
                      <div className="truncate text-sm font-medium">{r.label}</div>
                      {r.sublabel && <div className="truncate text-xs text-muted-foreground">{r.sublabel}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {int(r.jobs)}
                      {r.failed > 0 && <span className="ml-1 text-xs text-destructive">({r.failed} failed)</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {usd(r.costUsd)}
                      {r.failedCostUsd > 0 && <div className="text-[10px] text-muted-foreground">failed {usd(r.failedCostUsd)}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{usd(r.avgCostUsd)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {int(r.paidCreditsNet)}
                      {r.creditsNet - r.paidCreditsNet > 0 && (
                        <div className="text-[10px] text-muted-foreground">+{int(r.creditsNet - r.paidCreditsNet)} promo</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usd(r.creditValueUsd)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${r.profitUsd < 0 ? 'text-destructive' : ''}`}>{signedUsd(r.profitUsd)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={`tabular-nums ${marginTone(r.marginPct)}`}>{pct(r.marginPct)}</Badge>
                    </TableCell>
                    {dim === 'user' && <TableCell className="text-right tabular-nums">{cents(r.cashNetCents)}</TableCell>}
                    <TableCell>
                      {f && (
                        <Link href={jobsHref({ ...filters, ...f })} className="text-muted-foreground hover:text-foreground" title="View these jobs">
                          <ArrowUpRight className="h-4 w-4" />
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
