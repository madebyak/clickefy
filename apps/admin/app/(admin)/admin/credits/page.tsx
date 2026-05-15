'use client';

/**
 * Credits overview — a small set of KPI cards + the top burning
 * templates list. Heavier analytics live on /admin/analytics; this
 * page is for "what's the state of my pricing today" at a glance.
 */

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, Coins, Package, Repeat, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { fetchCreditsOverview } from '@/lib/api/credits';

export default function CreditsOverviewPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'credits', 'overview'],
    queryFn: () => fetchCreditsOverview(tokenGetter),
    refetchInterval: 60_000,
  });

  return (
    <div className="flex flex-col gap-6">
      {data?.catalog.unpricedModels ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div className="flex-1 text-sm">
              <span className="font-medium">
                {data.catalog.unpricedModels} model
                {data.catalog.unpricedModels === 1 ? '' : 's'} unpriced.
              </span>{' '}
              <span className="text-muted-foreground">
                Templates referencing them currently cost 0 credits per stage.
              </span>
            </div>
            <Link
              href="/admin/credits/models"
              className="text-sm font-medium text-primary-purple hover:underline"
            >
              Set prices →
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
          title="Credits issued (7d)"
          value={data?.ledger.issued_7d}
          subtitle={
            data ? `${data.ledger.issued_lifetime.toLocaleString()} lifetime` : ''
          }
          loading={isLoading}
        />
        <KpiCard
          icon={<TrendingDown className="h-4 w-4 text-rose-500" />}
          title="Credits spent (7d)"
          value={data?.ledger.spent_7d}
          subtitle={
            data ? `${data.ledger.spent_lifetime.toLocaleString()} lifetime` : ''
          }
          loading={isLoading}
        />
        <KpiCard
          icon={<Package className="h-4 w-4 text-primary-purple" />}
          title="Active top-up packs"
          value={data?.catalog.activePacks}
          subtitle={data ? `${data.catalog.totalPacks} total` : ''}
          loading={isLoading}
        />
        <KpiCard
          icon={<Repeat className="h-4 w-4 text-primary-purple" />}
          title="Active subscriptions"
          value={data?.catalog.activeSubscriptions}
          subtitle={data ? `${data.catalog.totalSubscriptions} total` : ''}
          loading={isLoading}
        />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary-purple" />
              Top burning templates (7d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : data?.topBurners.length ? (
              <ul className="divide-y">
                {data.topBurners.map((t) => (
                  <li key={t.templateId} className="flex items-center justify-between py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/admin/templates/${t.templateId}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {t.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">{t.runs} runs</p>
                    </div>
                    <div className="text-sm font-semibold">
                      <Coins className="mr-1 inline h-3.5 w-3.5 text-amber-500" />
                      {t.spent.toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No charges in the last 7 days.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent broadcasts</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : data?.recentBroadcasts.length ? (
              <ul className="divide-y">
                {data.recentBroadcasts.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">+{b.amount} credits — {b.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.grantedCount} / {b.recipientCount} users ·{' '}
                        {new Date(b.sentAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge variant="secondary">{b.grantedCount}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No broadcasts sent yet. (Coming in phase 3.)
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function KpiCard(props: {
  icon: React.ReactNode;
  title: string;
  value: number | undefined;
  subtitle?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-5">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {props.icon}
          {props.title}
        </div>
        {props.loading ? (
          <Skeleton className="mt-1 h-7 w-20" />
        ) : (
          <div className="text-2xl font-semibold">
            {(props.value ?? 0).toLocaleString()}
          </div>
        )}
        {props.subtitle ? (
          <p className="text-xs text-muted-foreground">{props.subtitle}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
