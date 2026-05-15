'use client';

/**
 * Live cost breakdown for the template editor.
 *
 * Reads `provider_models` (cached by TanStack Query) and sums the
 * cost across the current pipeline stages. Mirrors the server-side
 * formula in `apps/api/src/lib/template-cost.ts` so the admin sees
 * the same total they'd get from a save.
 *
 * Read-only: there's no manual override for total cost. Operators
 * who need a different price change the per-model cost on the
 * /admin/credits/models page.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Coins } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { fetchModels } from '@/lib/api/credits';
import type { TokenGetter } from '@/lib/api';

interface StageLike {
  id?: string;
  order?: number;
  provider: string;
  model: string;
}

interface TemplateCostSummaryProps {
  stages: ReadonlyArray<StageLike> | undefined;
  getToken: TokenGetter;
  className?: string;
}

export function TemplateCostSummary({
  stages,
  getToken,
  className,
}: TemplateCostSummaryProps) {
  const tokenGetter = useMemo(() => getToken, [getToken]);

  const { data: models, isLoading } = useQuery({
    queryKey: ['admin', 'credits', 'models'],
    queryFn: () => fetchModels(tokenGetter),
    staleTime: 60_000,
  });

  const priceByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of models ?? []) {
      map.set(`${m.provider}/${m.modelKey}`, m.costCredits);
    }
    return map;
  }, [models]);

  const orderedStages = useMemo(() => {
    return [...(stages ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [stages]);

  const breakdown = useMemo(() => {
    if (!models) return null;
    let total = 0;
    let missing = 0;
    const items = orderedStages.map((s) => {
      const key = `${s.provider}/${s.model}`;
      const price = priceByKey.get(key);
      const cost = price ?? 0;
      const isMissing = price === undefined;
      if (isMissing) missing += 1;
      total += cost;
      return { provider: s.provider, model: s.model, cost, missing: isMissing };
    });
    return { total, missing, items };
  }, [models, orderedStages, priceByKey]);

  if (isLoading) {
    return (
      <div className={cn('rounded-lg border bg-muted/30 p-4', className)}>
        <Skeleton className="h-6 w-48" />
      </div>
    );
  }

  if (!breakdown || breakdown.items.length === 0) {
    return (
      <div
        className={cn(
          'rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground',
          className,
        )}
      >
        Add at least one stage to see the credit cost.
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border bg-muted/30 p-4', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Credit cost breakdown
          </div>
          <ul className="flex flex-wrap items-center gap-1.5">
            {breakdown.items.map((item, idx) => (
              <li key={`${item.provider}-${item.model}-${idx}`} className="flex items-center gap-1">
                <Badge
                  variant={item.missing ? 'outline' : 'secondary'}
                  className={cn(
                    'font-mono text-xs',
                    item.missing &&
                      'border-amber-500/60 bg-amber-500/10 text-amber-700',
                  )}
                  title={`${item.provider} / ${item.model}`}
                >
                  {item.model} · {item.cost}
                  {item.missing ? ' ⚠' : ''}
                </Badge>
                {idx < breakdown.items.length - 1 ? (
                  <span className="text-muted-foreground">+</span>
                ) : null}
              </li>
            ))}
            <span className="text-muted-foreground">=</span>
          </ul>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <div className="text-xs uppercase text-muted-foreground">Total</div>
          <div className="flex items-center gap-1 text-2xl font-semibold tabular-nums">
            <Coins className="h-5 w-5 text-amber-500" />
            {breakdown.total}
          </div>
        </div>
      </div>

      {breakdown.missing > 0 ? (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span>
            {breakdown.missing} model{breakdown.missing === 1 ? '' : 's'} unpriced — those
            stages contribute 0 credits.{' '}
            <Link href="/admin/credits/models" className="font-medium underline">
              Set prices
            </Link>
          </span>
        </div>
      ) : null}
    </div>
  );
}
