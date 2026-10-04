'use client';

import type { AnalyticsBucket, CostSeriesPoint } from '@clickfy/types';

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { bucketLabel, usd } from '@/lib/analytics-format';

interface Props {
  series: CostSeriesPoint[];
  bucket: AnalyticsBucket;
}

/**
 * Credit value (what paid credits were worth) next to provider cost, one
 * pair of bars per bucket; the gap between them is the profit. Cash is
 * drawn as a thin marker when the response carries it.
 */
export function CostChart({ series, bucket }: Props) {
  const max = Math.max(1, ...series.map((p) => Math.max(p.creditValueUsd, p.costUsd, (p.cash?.netCents ?? 0) / 100)));
  const every = series.length > 40 ? Math.ceil(series.length / 20) : series.length > 16 ? 2 : 1;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="text-sm font-medium">Credit value vs provider cost</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-48 items-end gap-1">
          {series.map((p, i) => {
            const vH = (p.creditValueUsd / max) * 100;
            const cH = (p.costUsd / max) * 100;
            const cashH = p.cash ? ((p.cash.netCents / 100) / max) * 100 : null;
            const title = [
              bucketLabel(p.bucket, bucket),
              `${p.jobs} jobs (${p.failed} failed)`,
              `Credit value ${usd(p.creditValueUsd)}`,
              `Cost ${usd(p.costUsd)}${p.failedCostUsd ? ` (failed ${usd(p.failedCostUsd)})` : ''}`,
              `Profit ${usd(p.profitUsd)}${p.marginPct != null ? ` · ${p.marginPct}%` : ''}`,
              p.cash ? `Cash ${usd(p.cash.netCents / 100)}` : null,
            ].filter(Boolean).join('\n');
            return (
              <div key={p.bucket} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={title}>
                <div className="relative flex w-full flex-1 items-end justify-center gap-px">
                  <div className="w-1/2 rounded-t-sm bg-primary-purple/70" style={{ height: `${vH}%` }} />
                  <div className="w-1/2 rounded-t-sm bg-warning/70" style={{ height: `${cH}%` }} />
                  {cashH != null && cashH > 0 && (
                    <div className="absolute left-0 right-0 border-t-2 border-dashed border-primary-green/80" style={{ bottom: `${cashH}%` }} />
                  )}
                </div>
                <span className="h-3 text-[10px] text-muted-foreground">{i % every === 0 ? bucketLabel(p.bucket, bucket) : ''}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-primary-purple/70" />Credit value (paid credits × $0.10)</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-warning/70" />Provider cost</span>
          {series.some((p) => p.cash) && (
            <span className="inline-flex items-center gap-1.5"><span className="h-0 w-3 border-t-2 border-dashed border-primary-green/80" />Cash received</span>
          )}
          <span className="ml-auto">Hover a bar for the numbers · Dubai calendar</span>
        </div>
      </CardContent>
    </Card>
  );
}
